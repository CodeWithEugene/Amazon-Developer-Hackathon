import { z } from "zod"

/**
 * Media helpers. Ring frames carry a mandatory server-side watermark band
 * (logo, device id, app name, timestamp) across the top; inference must run
 * on a cropped copy while the displayed and stored frame keeps the band.
 */

export const DEFAULT_WATERMARK_RATIO = 0.15
/** Snapshots come from recordings a few seconds after an event (Section 2.7). */
export const DEFAULT_SNAPSHOT_DELAY_MS = 15_000
export const DEFAULT_SNAPSHOT_RANGE_MS = 20_000
export const LATEST_IN_RANGE_MAX_MS = 24 * 60 * 60 * 1000

export interface ImageDataLike {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array | Uint8ClampedArray
}

export interface CroppedImage {
  readonly width: number
  readonly height: number
  readonly channels: number
  readonly data: Uint8ClampedArray
  readonly removedRows: number
}

/**
 * Pure crop of the top `ratio` of the frame. Channel count is derived from
 * the buffer length (RGBA 4, RGB 3, gray 1); the input is never mutated.
 */
export const cropWatermarkBand = (
  image: ImageDataLike,
  ratio: number = DEFAULT_WATERMARK_RATIO
): CroppedImage => {
  const { width, height, data } = image
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError("cropWatermarkBand: width and height must be positive integers")
  }
  if (!(ratio >= 0 && ratio < 1)) {
    throw new RangeError("cropWatermarkBand: ratio must be in [0, 1)")
  }
  const pixels = width * height
  if (data.length % pixels !== 0) {
    throw new RangeError("cropWatermarkBand: data length is not a whole number of channels")
  }
  const channels = data.length / pixels
  const removedRows = Math.min(height - 1, Math.round(height * ratio))
  const start = removedRows * width * channels
  return {
    width,
    height: height - removedRows,
    channels,
    data: Uint8ClampedArray.from(data.subarray(start)),
    removedRows,
  }
}

export const snapshotFormatSchema = z.enum(["jpeg", "png"])
export type SnapshotFormat = z.infer<typeof snapshotFormatSchema>

export const snapshotRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("at_timestamp"),
    timestamp: z.number().int().nonnegative(),
    format: snapshotFormatSchema.default("jpeg"),
  }),
  z.object({
    type: z.literal("latest_in_range"),
    start_time: z.number().int().nonnegative(),
    end_time: z.number().int().nonnegative(),
    format: snapshotFormatSchema.default("jpeg"),
  }),
])
export type SnapshotRequest = z.infer<typeof snapshotRequestSchema>
export type SnapshotRequestInput = z.input<typeof snapshotRequestSchema>

export interface SnapshotPlan {
  /** Wait this long after the event before requesting (recording readiness). */
  readonly requestAfterMs: number
  readonly requestAt: number
  readonly atTimestamp: SnapshotRequest
  readonly latestInRange: SnapshotRequest
}

/**
 * Bodies for both snapshot strategies anchored on an event timestamp:
 * `at_timestamp` asks for the frame closest to the event; `latest_in_range`
 * takes the newest frame between the event and `rangeMs` later (capped at the
 * documented 24 hour window).
 */
export const snapshotRequestAfterEvent = (
  eventTimestampMs: number,
  options: {
    readonly delayMs?: number
    readonly rangeMs?: number
    readonly format?: SnapshotFormat
  } = {}
): SnapshotPlan => {
  if (!Number.isInteger(eventTimestampMs) || eventTimestampMs < 0) {
    throw new RangeError("snapshotRequestAfterEvent: eventTimestampMs must be a non-negative integer")
  }
  const delayMs = options.delayMs ?? DEFAULT_SNAPSHOT_DELAY_MS
  const rangeMs = Math.min(options.rangeMs ?? DEFAULT_SNAPSHOT_RANGE_MS, LATEST_IN_RANGE_MAX_MS)
  const format = options.format ?? "jpeg"
  return {
    requestAfterMs: delayMs,
    requestAt: eventTimestampMs + delayMs,
    atTimestamp: { type: "at_timestamp", timestamp: eventTimestampMs, format },
    latestInRange: {
      type: "latest_in_range",
      start_time: eventTimestampMs,
      end_time: eventTimestampMs + rangeMs,
      format,
    },
  }
}
