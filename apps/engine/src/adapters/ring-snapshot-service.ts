/**
 * Snapshot fetcher adapter: Ring snapshot (303 flow) to S3, recorded as a
 * Snapshot entity (docs/build.md Section 4, research.md Section 2.7).
 *
 * - Consent first: nothing is requested unless the family enabled snapshots
 *   and the Ring link is neither "removed" nor "paused" (contract C3).
 * - `RingClient.snapshot` POSTs the request and follows the 303 redirect to
 *   the presigned media URL. The frame is stored as Ring returned it, with the
 *   watermark band intact.
 * - 416 (no media in range) and 403 (before the consent time) are final: no
 *   retry. 425 (recording not ready) is reported so the next sweep retries.
 *   An encrypted (E2EE) frame is never stored.
 * - The S3 object is tagged with the consent retention class so the bucket
 *   lifecycle expires it; the Snapshot row carries the same `expiresAt` TTL.
 */
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3"
import {
  SNAPSHOT_KEY_PREFIX,
  SNAPSHOT_RETENTION_TAG_KEY,
  snapshotRetentionClass,
} from "@visitproof/db"
import {
  snapshotSchema,
  type Client,
  type DoorEvent,
  type Snapshot,
  type Visit,
} from "@visitproof/domain"
import {
  RingMediaNotFoundError,
  RingRecordingNotReadyError,
  RingTimeRangeNotAuthorizedError,
  snapshotRequestAfterEvent,
  type SnapshotRequestInput,
  type SnapshotResult,
} from "@visitproof/ring-partner-sdk"

import {
  consoleLogger,
  type ClientStore,
  type Clock,
  type DoorEventStore,
  type Logger,
  type SnapshotRecordStore,
  type SnapshotService,
} from "../lib/ports"

const SECONDS_PER_DAY = 86_400

/** The slice of `RingClient` this adapter needs (RingClient satisfies it). */
export interface SnapshotSource {
  snapshot(
    deviceId: string,
    request: SnapshotRequestInput
  ): Promise<SnapshotResult>
}

export type SnapshotOutcome =
  | { status: "stored"; snapshot: Snapshot }
  | {
      status: "skipped"
      reason:
        "consent" | "already_stored" | "no_arrival" | "no_device" | "not_yet"
    }
  | { status: "no_media" | "not_authorized" | "encrypted" }
  | { status: "not_ready"; retryAfterMs: number | undefined }

export interface RingS3SnapshotOptions {
  ring: SnapshotSource
  s3: Pick<S3Client, "send">
  bucket: string
  clients: ClientStore
  events: DoorEventStore
  records: SnapshotRecordStore
  clock: Clock
  logger?: Logger
}

const consentAllows = (client: Client | undefined): client is Client =>
  client !== undefined &&
  client.consent.snapshotsEnabled &&
  client.ringLinkStatus !== "removed" &&
  client.ringLinkStatus !== "paused"

const extensionFor = (contentType: string): string =>
  contentType.includes("png") ? "png" : "jpg"

async function requestFrame(
  ring: SnapshotSource,
  deviceId: string,
  request: SnapshotRequestInput
): Promise<
  SnapshotResult | Exclude<SnapshotOutcome, { status: "stored" | "skipped" }>
> {
  try {
    return await ring.snapshot(deviceId, request)
  } catch (error) {
    if (error instanceof RingMediaNotFoundError) return { status: "no_media" }
    if (error instanceof RingTimeRangeNotAuthorizedError)
      return { status: "not_authorized" }
    if (error instanceof RingRecordingNotReadyError) {
      return { status: "not_ready", retryAfterMs: error.retryAfterMs }
    }
    throw error
  }
}

export class RingS3SnapshotService implements SnapshotService {
  private readonly logger: Logger

  constructor(private readonly options: RingS3SnapshotOptions) {
    this.logger = options.logger ?? consoleLogger
  }

  async request(visit: Visit): Promise<void> {
    const outcome = await this.fetch(visit)
    if (outcome.status !== "stored" && outcome.status !== "skipped") {
      this.logger.warn("[snapshot] no snapshot stored", {
        visitId: visit.id,
        outcome: outcome.status,
      })
    }
  }

  private async arrivalEvent(visit: Visit): Promise<DoorEvent | undefined> {
    const eventId = visit.arrival?.eventId
    if (eventId === undefined) return undefined
    const events = await this.options.events.listForClient(visit.clientId)
    return events.find((event) => event.requestId === eventId)
  }

  async fetch(visit: Visit): Promise<SnapshotOutcome> {
    const client = await this.options.clients.get(visit.clientId)
    if (!consentAllows(client)) return { status: "skipped", reason: "consent" }
    if ((await this.options.records.listForVisit(visit.id)).length > 0) {
      return { status: "skipped", reason: "already_stored" }
    }
    const event = await this.arrivalEvent(visit)
    if (event === undefined) return { status: "skipped", reason: "no_arrival" }
    if (event.deviceId === undefined)
      return { status: "skipped", reason: "no_device" }
    const now = this.options.clock.now()
    const plan = snapshotRequestAfterEvent(event.timestampMs)
    if (now.getTime() < plan.requestAt)
      return { status: "skipped", reason: "not_yet" }

    const frame = await requestFrame(
      this.options.ring,
      event.deviceId,
      plan.latestInRange
    )
    if ("status" in frame) return frame
    if (frame.encrypted === true) return { status: "encrypted" }
    return {
      status: "stored",
      snapshot: await this.store(visit, client, event, frame, now),
    }
  }

  private async store(
    visit: Visit,
    client: Client,
    event: DoorEvent,
    frame: SnapshotResult,
    now: Date
  ): Promise<Snapshot> {
    const days = snapshotRetentionClass(client.consent.snapshotRetentionDays)
    const key = `${SNAPSHOT_KEY_PREFIX}${visit.clientId}/${visit.id}/${event.timestampMs}.${extensionFor(frame.contentType)}`
    await this.options.s3.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: frame.bytes,
        ContentType: frame.contentType,
        Tagging: `${SNAPSHOT_RETENTION_TAG_KEY}=${days}`,
      })
    )
    const iso = now.toISOString()
    const snapshot = snapshotSchema.parse({
      createdAt: iso,
      updatedAt: iso,
      version: 1,
      visitId: visit.id,
      at: event.at,
      s3Key: key,
      mediaOrigin: frame.origin === "recording" ? "recording" : "snapshot",
      labels: [],
      // Not measured yet: the frame is stored undecoded with its band intact.
      watermarkBandPx: 0,
      requestedAt: iso,
      provenance: event.provenance,
      expiresAt: Math.floor(now.getTime() / 1000) + days * SECONDS_PER_DAY,
    })
    await this.options.records.put(snapshot)
    return snapshot
  }
}
