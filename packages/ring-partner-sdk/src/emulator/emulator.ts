import { newRequestId } from "../crypto"
import { signWebhookBody } from "../webhook"
import { WEBHOOK_VERSION, type WebhookEnvelope, type WebhookEvent } from "../types"
import {
  SCENARIOS,
  SCENARIO_ALIASES,
  TWO_WEEKS_CLIENTS,
  TWO_WEEKS_DAY_MS,
  type PrimitiveKind,
  type ScenarioName,
  type TwoWeeksClient,
  type TwoWeeksVisit,
} from "./scenarios"

/**
 * `RingEmulator` generates signed v1.1 webhook payloads (docs/build.md
 * Section 5.1, friction log entry 1: the Playground cannot drive webhooks, so
 * the event path is tested through this emulator). Every delivery is a valid
 * envelope signed with HMAC-SHA256 over the exact serialized bytes, carries a
 * unique `request_id` (idempotency/dedupe key), and a strictly increasing
 * timestamp, so replays cannot collide.
 */

export interface WebhookDelivery {
  readonly envelope: WebhookEnvelope
  /** The exact bytes that were signed; deliver these as the raw body. */
  readonly rawBody: Uint8Array
  /** The `x-signature` header value (`sha256=<hex>`). */
  readonly header: string
  readonly headers: Readonly<Record<string, string>>
  /** ISO time of the event; useful for ordering the replay. */
  readonly at: number
}

export interface EmitOptions {
  readonly deviceId: string
  readonly accountId?: string
  /** Epoch ms of the event; defaults to the emulator clock (strictly increasing). */
  readonly at?: number
}

export interface ScenarioOptions extends EmitOptions {
  /** Epoch ms of the visit's scheduled start (defaults to the clock). */
  readonly visitStartAt?: number
}

export interface TwoWeeksVisitPlan extends TwoWeeksVisit {
  readonly clientId: string
  readonly deviceId: string
  readonly accountId: string
  readonly caregiver: string
  readonly scheduledStartAt: number
  readonly scheduledEndAt: number
  readonly expected: string
}

export interface TwoWeeksReplay {
  readonly startAt: number
  readonly endAt: number
  readonly clients: readonly TwoWeeksClient[]
  readonly visits: readonly TwoWeeksVisitPlan[]
  /** Deliveries sorted oldest first; ready to POST in order. */
  readonly deliveries: readonly WebhookDelivery[]
}

export interface RingEmulatorOptions {
  /** The HMAC signing key (RING_HMAC_SIGNING_KEY in the app). */
  readonly signingKey: string
  readonly now?: () => number
  readonly requestId?: () => string
  readonly baseUrl?: string
}

const DEFAULT_ACCOUNT_ID = "ava1.ring.account.emulated"
const DEFAULT_VISIT_DURATION_MS = 2 * 60 * 60 * 1000

const KIND_TO_EVENT: Readonly<
  Record<PrimitiveKind, (deviceId: string, at: number) => Omit<WebhookEvent, "id">>
> = {
  ding: (source, at) => ({
    type: "button_press",
    relationships: { devices: { links: { self: `/v1/devices/${source}` } } },
    attributes: {
      source,
      source_type: "devices",
      timestamp: at,
      timestamp_readable: new Date(at).toISOString(),
    },
  }),
  motion_human: (source, at) => ({
    type: "motion_detected",
    relationships: { devices: { links: { self: `/v1/devices/${source}` } } },
    attributes: {
      source,
      source_type: "devices",
      timestamp: at,
      timestamp_readable: new Date(at).toISOString(),
      sub_type: "human",
      component_ids: ["0"],
    },
  }),
  motion_vehicle: (source, at) => ({
    type: "motion_detected",
    relationships: { devices: { links: { self: `/v1/devices/${source}` } } },
    attributes: {
      source,
      source_type: "devices",
      timestamp: at,
      timestamp_readable: new Date(at).toISOString(),
      sub_type: "vehicle",
      component_ids: ["0"],
    },
  }),
  device_offline: (source, at) => ({
    type: "device_offline",
    relationships: { devices: { links: { self: `/v1/devices/${source}` } } },
    attributes: {
      source,
      source_type: "devices",
      timestamp: at,
      timestamp_readable: new Date(at).toISOString(),
    },
  }),
  device_online: (source, at) => ({
    type: "device_online",
    relationships: { devices: { links: { self: `/v1/devices/${source}` } } },
    attributes: {
      source,
      source_type: "devices",
      timestamp: at,
      timestamp_readable: new Date(at).toISOString(),
    },
  }),
  integration_removed: (source, at) => ({
    type: "app_integration_removed",
    relationships: undefined,
    attributes: {
      source,
      source_type: "accounts",
      timestamp: at,
      timestamp_readable: new Date(at).toISOString(),
    },
  }),
  subscription_deactivated: (source, at) => ({
    type: "subscription_deactivated",
    relationships: undefined,
    attributes: {
      source,
      source_type: "subscriptions",
      timestamp: at,
      timestamp_readable: new Date(at).toISOString(),
    },
  }),
}

const resolveScenario = (name: string): ScenarioName => {
  const canonical = (SCENARIOS as Record<string, unknown>)[name]
    ? (name as ScenarioName)
    : SCENARIO_ALIASES[name]
  if (!canonical || !SCENARIOS[canonical]) {
    throw new RangeError(`Unknown emulator scenario: ${name}`)
  }
  return canonical
}

/**
 * The engine's actual outcome per scripted visit kind. Note `double`: the
 * vehicle motion is not an arrival signal, so the ding forms a single
 * cluster, the arrival is chosen deterministically (never ambiguous), and
 * the trailing human motion records the departure — a completed visit.
 */
const EXPECTED_BY_VISIT: Readonly<Record<TwoWeeksVisit["kind"], string>> = {
  on_time: "arrived_on_time",
  late: "arrived_late",
  no_show: "no_show",
  early: "early_departure",
  unobservable: "unobservable",
  double: "completed",
}

export class RingEmulator {
  readonly signingKey: string
  readonly baseUrl: string
  private readonly now: () => number
  private readonly requestId: () => string
  /** High-water mark so two deliveries never share a timestamp. */
  private lastTimestamp = 0

  constructor(options: RingEmulatorOptions) {
    if (!options.signingKey) throw new RangeError("RingEmulator requires a signingKey")
    this.signingKey = options.signingKey
    this.baseUrl = options.baseUrl ?? "https://emu.ring.local"
    this.now = options.now ?? Date.now
    this.requestId = options.requestId ?? newRequestId
  }

  /** Replay-safe event time: never before a previous delivery's timestamp. */
  private nextAt(at?: number): number {
    const candidate = at ?? Math.max(this.now(), this.lastTimestamp + 1)
    const safe = Math.max(candidate, this.lastTimestamp + 1)
    this.lastTimestamp = safe
    return safe
  }

  /** Builds, signs, and returns one webhook delivery. */
  emit(kind: PrimitiveKind, options: EmitOptions): WebhookDelivery {
    const at = this.nextAt(options.at)
    const partial = KIND_TO_EVENT[kind](options.deviceId, at)
    const envelope: WebhookEnvelope = {
      meta: {
        version: WEBHOOK_VERSION,
        time: new Date(at).toISOString(),
        request_id: this.requestId(),
        account_id: options.accountId ?? DEFAULT_ACCOUNT_ID,
      },
      data: {
        ...partial,
        id: `${options.deviceId}_${partial.type}_${at}`,
        ...(partial.relationships === undefined ? {} : { relationships: partial.relationships }),
      } as WebhookEvent,
    }
    const rawBody = new TextEncoder().encode(JSON.stringify(envelope))
    const header = signWebhookBody(rawBody, this.signingKey)
    return {
      envelope,
      rawBody,
      header,
      headers: { "x-signature": header, "content-type": "application/json" },
      at,
    }
  }

  ding(options: EmitOptions): WebhookDelivery {
    return this.emit("ding", options)
  }

  motion(options: EmitOptions, subType: "human" | "vehicle" = "human"): WebhookDelivery {
    return this.emit(subType === "vehicle" ? "motion_vehicle" : "motion_human", options)
  }

  /** Arrival at the door: a doorbell press immediately followed by human motion. */
  arrival(options: EmitOptions & { readonly at?: number }): readonly WebhookDelivery[] {
    const base = options.at ?? this.nextAt()
    return [
      this.emit("ding", { ...options, at: base }),
      this.emit("motion_human", { ...options, at: base + 30_000 }),
    ]
  }

  /** Departure: human motion after the visit window ends. */
  departure(options: EmitOptions & { readonly at?: number; readonly afterMs?: number }): WebhookDelivery {
    const at = options.at ?? this.nextAt() + (options.afterMs ?? 0)
    return this.emit("motion_human", { ...options, at })
  }

  /** Every delivery for a named scenario, in order, anchored on the visit start. */
  scenario(name: string, options: ScenarioOptions): readonly WebhookDelivery[] {
    const script = SCENARIOS[resolveScenario(name)]
    const anchor = options.visitStartAt ?? this.nextAt()
    this.lastTimestamp = Math.max(this.lastTimestamp, anchor - 1)
    return script.steps.map((step) =>
      this.emit(step.kind, { ...options, at: anchor + step.offsetMs })
    )
  }

  /** Scenario metadata (steps, description) without emitting anything. */
  script(name: string) {
    return SCENARIOS[resolveScenario(name)]
  }

  /**
   * The scripted two-week replay for the three demo clients: 84 visits, 62
   * on-time, 9 late, 4 no-show, 5 early departures, 3 unobservable, 1 double
   * visitor. `startAt` is 00:00 UTC of day 0; days are UTC days.
   */
  twoWeeks(options: { readonly startAt: number }): TwoWeeksReplay {
    if (!Number.isInteger(options.startAt) || options.startAt <= 0) {
      throw new RangeError("twoWeeks: startAt must be a positive epoch ms integer")
    }
    const plans: TwoWeeksVisitPlan[] = []
    // Events are collected per visit, then emitted in global time order: the
    // per-client loop would otherwise feed `nextAt` non-monotonic anchors and
    // the high-water clamp would drag later clients' events out of their
    // visit windows.
    const pending: {
      readonly kind: PrimitiveKind
      readonly at: number
      readonly deviceId: string
      readonly accountId: string
    }[] = []
    for (const client of TWO_WEEKS_CLIENTS) {
      for (const [index, visit] of client.visits.entries()) {
        const scheduledStartAt =
          options.startAt + visit.day * TWO_WEEKS_DAY_MS +
          (visit.hour * 60 + visit.minute) * 60_000
        const caregiver = client.caregivers[index % client.caregivers.length]!
        plans.push({
          ...visit,
          clientId: client.clientId,
          deviceId: client.deviceId,
          accountId: client.accountId,
          caregiver,
          scheduledStartAt,
          scheduledEndAt: scheduledStartAt + DEFAULT_VISIT_DURATION_MS,
          expected: EXPECTED_BY_VISIT[visit.kind],
        })
        const late = (visit.lateMin ?? 20) * 60_000
        const leaveAt = (visit.leaveAtMin ?? 30) * 60_000
        const end = scheduledStartAt + DEFAULT_VISIT_DURATION_MS
        const push = (kind: PrimitiveKind, at: number): void => {
          pending.push({ kind, at, deviceId: client.deviceId, accountId: client.accountId })
        }
        // Front-door realism: the doorbell press is the arrival; the next
        // front-door human motion is the caregiver leaving. A motion right
        // after entry would be pinned as the departure by the engine's
        // quiet-period rule once the door goes quiet mid-visit.
        switch (visit.kind) {
          case "on_time":
          case "double":
            push("ding", scheduledStartAt)
            if (visit.kind === "double") push("motion_vehicle", scheduledStartAt + 15_000)
            push("motion_human", end + 5_000)
            break
          case "late":
            push("ding", scheduledStartAt + late)
            push("motion_human", end + late)
            break
          case "no_show":
            break
          case "early":
            push("ding", scheduledStartAt)
            push("motion_human", scheduledStartAt + leaveAt)
            break
          case "unobservable":
            push("ding", scheduledStartAt)
            push("device_offline", scheduledStartAt + 30 * 60_000)
            break
        }
      }
    }
    pending.sort((a, b) => a.at - b.at)
    const deliveries = pending.map((step) =>
      this.emit(step.kind, {
        deviceId: step.deviceId,
        accountId: step.accountId,
        at: step.at,
      })
    )
    const endAt = plans.reduce(
      (max, plan) => Math.max(max, plan.scheduledEndAt),
      options.startAt
    )
    return { startAt: options.startAt, endAt, clients: TWO_WEEKS_CLIENTS, visits: plans, deliveries }
  }

  /** Resets the timestamp high-water mark (between independent replays). */
  reset(): void {
    this.lastTimestamp = 0
  }
}
