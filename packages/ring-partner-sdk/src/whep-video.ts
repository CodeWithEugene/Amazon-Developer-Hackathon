import { z } from "zod"

/**
 * "Connected but no video" detection for WHEP live view. On 22 October 2026
 * the Ring Playground doorbell reached ICE and DTLS `connected` and
 * negotiated H264 and Opus, yet sent about 2.4 KB in 13 seconds and no
 * `inbound-rtp` stats ever appeared. The sandbox appears to stream only
 * during a simulated event (untested). These pure helpers read `getStats()` and decide whether
 * video is flowing, still allowed to start, or not arriving at all.
 * Browser safe: no Node imports.
 */

export const NO_VIDEO_TIMEOUT_MS = 8_000
export const VIDEO_CHECK_INTERVAL_MS = 1_000

export interface InboundMediaSample {
  /** Frames decoded across inbound video streams. */
  readonly framesDecoded: number
  /** Bytes received across every inbound RTP stream (video and audio). */
  readonly bytesReceived: number
  /** False when the browser reported no inbound video stream at all. */
  readonly hasInboundVideo: boolean
}

export type VideoProgress = "flowing" | "waiting" | "no_video"

/** The part of `RTCStatsReport` the detector needs (a Map works in tests). */
export interface StatsReportLike {
  forEach(callback: (report: unknown) => void): void
}

const inboundRtpSchema = z.looseObject({
  type: z.literal("inbound-rtp"),
  kind: z.string().optional(),
  mediaType: z.string().optional(),
  framesDecoded: z.number().nonnegative().optional(),
  bytesReceived: z.number().nonnegative().optional(),
})

export const EMPTY_INBOUND_SAMPLE: InboundMediaSample = { framesDecoded: 0, bytesReceived: 0, hasInboundVideo: false }

/** Sums inbound RTP counters from a stats report. */
export const readInboundMedia = (stats: StatsReportLike): InboundMediaSample => {
  let sample = EMPTY_INBOUND_SAMPLE
  stats.forEach((report) => {
    const parsed = inboundRtpSchema.safeParse(report)
    if (!parsed.success) return
    const isVideo = (parsed.data.kind ?? parsed.data.mediaType) === "video"
    sample = {
      framesDecoded: sample.framesDecoded + (isVideo ? (parsed.data.framesDecoded ?? 0) : 0),
      bytesReceived: sample.bytesReceived + (parsed.data.bytesReceived ?? 0),
      hasInboundVideo: sample.hasInboundVideo || isVideo,
    }
  })
  return sample
}

export interface VideoProgressInput {
  readonly sample: InboundMediaSample
  /** When the peer connection reached `connected` (epoch ms). */
  readonly connectedAt: number
  readonly now: number
  readonly timeoutMs?: number
}

/** "flowing" once a frame decodes; "no_video" when none has by the timeout. */
export const classifyVideoProgress = (input: VideoProgressInput): VideoProgress => {
  if (input.sample.framesDecoded > 0) return "flowing"
  return input.now - input.connectedAt >= (input.timeoutMs ?? NO_VIDEO_TIMEOUT_MS) ? "no_video" : "waiting"
}
