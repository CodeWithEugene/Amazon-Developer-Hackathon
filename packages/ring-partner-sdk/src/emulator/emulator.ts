import { newRequestId } from "../crypto"
import { signWebhookBody } from "../webhook"
import {
  EMULATED_PROVENANCE,
  PROVENANCE_HEADER,
  WEBHOOK_VERSION,
  type WebhookEnvelope,
  type WebhookEvent,
} from "../types"
import { eventId, KIND_TO_EVENT } from "./payloads"
import {
  SCENARIOS,
  SCENARIO_ALIASES,
  TWO_WEEKS_CLIENTS,
  TWO_WEEKS_TIME_ZONE,
  type PrimitiveKind,
  type ScenarioName,
  type TwoWeeksClient,
} from "./scenarios"
import { planTwoWeeks, type TwoWeeksPlanOptions, type TwoWeeksVisitPlan } from "./two-weeks"

export {
  emulatedDeviceCheck,
  ENCRYPTION_REPORTED_MARGIN_MS,
  EXPECTED_BY_VISIT,
  OUTAGE_RESTORED_AFTER_END_MS,
  planTwoWeeks,
  TWO_WEEKS_VISIT_DURATION_MS,
  UNOBSERVABLE_OFFLINE_AFTER_MS,
  type EmulatedDeviceCheck,
  type EvvBehavior,
  type EvvPlan,
  type PlannedEvent,
  type TwoWeeksPlanOptions,
  type TwoWeeksVisitPlan,
} from "./two-weeks"

/**
 * `RingEmulator` generates signed v1.1 webhook payloads (docs/build.md
 * Section 5.1, friction log entry 1: the Playground cannot drive webhooks, so
 * the event path is tested through this emulator). Every delivery is a valid
 * envelope signed with HMAC-SHA256 over the exact serialized bytes, carries a
 * unique `request_id` (idempotency/dedupe key), a strictly increasing
 * timestamp, and the `x-visitproof-provenance: emulated` header so a demo
 * receiver labels it "Emulated event".
 */

export interface WebhookDelivery {
  readonly envelope: WebhookEnvelope
  /** The exact bytes that were signed; deliver these as the raw body. */
  readonly rawBody: Uint8Array
  /** The `x-signature` header value (`sha256=<hex>`). */
  readonly header: string
  readonly headers: Readonly<Record<string, string>>
  /** Epoch ms of the event; useful for ordering the replay. */
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

export interface TwoWeeksReplay {
  readonly startAt: number
  readonly endAt: number
  readonly timeZone: string
  readonly clients: readonly TwoWeeksClient[]
  /** Ground truth per visit: schedule, intended outcome, door events, EVV plan. */
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
  /** Device local time zone for `timestamp_readable` (default America/New_York). */
  readonly timeZone?: string
}

const DEFAULT_ACCOUNT_ID = "ava1.ring.account.emulated"

const resolveScenario = (name: string): ScenarioName => {
  const canonical = (SCENARIOS as Record<string, unknown>)[name]
    ? (name as ScenarioName)
    : SCENARIO_ALIASES[name]
  if (!canonical || !SCENARIOS[canonical]) {
    throw new RangeError(`Unknown emulator scenario: ${name}`)
  }
  return canonical
}

export class RingEmulator {
  readonly signingKey: string
  readonly baseUrl: string
  readonly timeZone: string
  private readonly now: () => number
  private readonly requestId: () => string
  /** High-water mark so two deliveries never share a timestamp. */
  private lastTimestamp = 0

  constructor(options: RingEmulatorOptions) {
    if (!options.signingKey) throw new RangeError("RingEmulator requires a signingKey")
    this.signingKey = options.signingKey
    this.baseUrl = options.baseUrl ?? "https://emu.ring.local"
    this.timeZone = options.timeZone ?? TWO_WEEKS_TIME_ZONE
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
    const partial = KIND_TO_EVENT[kind](options.deviceId, at, this.timeZone)
    const envelope: WebhookEnvelope = {
      meta: {
        version: WEBHOOK_VERSION,
        time: new Date(at).toISOString(),
        request_id: this.requestId(),
        account_id: options.accountId ?? DEFAULT_ACCOUNT_ID,
      },
      data: {
        ...partial,
        id: eventId(options.deviceId, partial.type, at),
        ...(partial.relationships === undefined ? {} : { relationships: partial.relationships }),
      } as WebhookEvent,
    }
    const rawBody = new TextEncoder().encode(JSON.stringify(envelope))
    const header = signWebhookBody(rawBody, this.signingKey)
    return {
      envelope,
      rawBody,
      header,
      headers: {
        "x-signature": header,
        "content-type": "application/json",
        [PROVENANCE_HEADER]: EMULATED_PROVENANCE,
      },
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
   * visitor, at realistic New York local times with seeded jitter.
   * `startAt` is 00:00 UTC of day 0's calendar date.
   */
  twoWeeks(options: TwoWeeksPlanOptions): TwoWeeksReplay {
    const timeZone = options.timeZone ?? TWO_WEEKS_TIME_ZONE
    const visits = planTwoWeeks({ ...options, timeZone })
    // Events are emitted in global time order: per-client order would feed
    // `nextAt` non-monotonic anchors and drag later events out of window.
    const pending = visits
      .flatMap((plan) =>
        plan.events.map((event) => ({ ...event, deviceId: plan.deviceId, accountId: plan.accountId }))
      )
      .sort((a, b) => a.at - b.at)
    const deliveries = pending.map((step) =>
      this.emit(step.kind, { deviceId: step.deviceId, accountId: step.accountId, at: step.at })
    )
    const endAt = visits.reduce((max, plan) => Math.max(max, plan.scheduledEndAt), options.startAt)
    return { startAt: options.startAt, endAt, timeZone, clients: TWO_WEEKS_CLIENTS, visits, deliveries }
  }

  /** Resets the timestamp high-water mark (between independent replays). */
  reset(): void {
    this.lastTimestamp = 0
  }
}
