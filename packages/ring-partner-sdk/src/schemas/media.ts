import { z } from "zod"

import { openEnum } from "./open-enum"

/** Media wire types: snapshots, clips, WHEP, and media error codes. */

export const snapshotTypeSchema = z.enum(["at_timestamp", "latest_in_range"])
export type SnapshotType = z.infer<typeof snapshotTypeSchema>

export const KNOWN_MEDIA_ORIGINS = ["recording", "snapshot"] as const
export const mediaOriginSchema = openEnum(KNOWN_MEDIA_ORIGINS)
export type MediaOrigin = z.infer<typeof mediaOriginSchema>

export const mediaErrorCodeSchema = z.enum([
  "MEDIA_NOT_FOUND",
  "RECORDING_NOT_READY",
  "TIME_RANGE_NOT_AUTHORIZED",
  "MEDIA_ENCRYPTED",
])
export type MediaErrorCode = z.infer<typeof mediaErrorCodeSchema>

export const whepStartResponseSchema = z.object({
  sdpAnswer: z.string().min(1),
  sessionUrl: z.string().min(1),
})
export type WhepStartResponse = z.infer<typeof whepStartResponseSchema>

/** WHEP session caps (docs/research.md Section 2.2); sessions are not reaped. */
export const WHEP_BATTERY_CAP_MS = 30_000
export const WHEP_WIRED_CAP_MS = 60_000

export const whepCapFor = (batteryPowered: boolean | undefined): number =>
  batteryPowered === false ? WHEP_WIRED_CAP_MS : WHEP_BATTERY_CAP_MS

export const clipRequestSchema = z.object({
  start_time: z.number().int().nonnegative(),
  end_time: z.number().int().nonnegative(),
})
export type ClipRequest = z.infer<typeof clipRequestSchema>

/** Clips are capped at 15 minutes (docs/research.md Section 2.2). */
export const CLIP_MAX_DURATION_MS = 15 * 60 * 1000
