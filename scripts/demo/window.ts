/**
 * The simulated window. Day 13 of the two-week dataset is today in the
 * agency time zone; the replay runs until every visit has settled (the
 * default), or only until the wall clock with VISITPROOF_DEMO_UNTIL=now.
 */
import { localDateKey } from "@visitproof/domain"
import {
  RingEmulator,
  TWO_WEEKS_DAY_MS,
  TWO_WEEKS_DAYS,
  type TwoWeeksReplay,
} from "@visitproof/ring-partner-sdk"

import { TIME_ZONE } from "./config"
import { SETTLE_AFTER_END_MS } from "./replay"

export interface DemoWindow {
  readonly replay: TwoWeeksReplay
  readonly from: number
  /** Simulated "now" when the replay stops. */
  readonly to: number
  /** The replay covers every visit, so the summary can be checked. */
  readonly complete: boolean
}

/** 00:00 UTC of the calendar date that is `daysBack` before today in the agency zone. */
export function windowStart(nowMs: number, daysBack: number): number {
  const [year, month, day] = localDateKey(
    new Date(nowMs).toISOString(),
    TIME_ZONE
  )
    .split("-")
    .map(Number)
  return Date.UTC(year!, month! - 1, day!) - daysBack * TWO_WEEKS_DAY_MS
}

export function demoWindow(
  nowMs: number,
  until: "end" | "now",
  signingKey: string
): DemoWindow {
  const from = windowStart(nowMs, TWO_WEEKS_DAYS - 1)
  const replay = new RingEmulator({ signingKey, timeZone: TIME_ZONE }).twoWeeks(
    { startAt: from, timeZone: TIME_ZONE }
  )
  const settled = replay.endAt + SETTLE_AFTER_END_MS
  const to = until === "now" ? Math.min(nowMs, settled) : settled
  return { replay, from, to, complete: to === settled }
}
