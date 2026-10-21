import type {
  Exception,
  ExceptionResolution,
  ExceptionState,
} from "@visitproof/domain"

import { ConflictError } from "./errors"

/**
 * The exception state machine, pure. A snoozed card is effectively open
 * again once `snoozeUntil` has passed, so it reappears on the board without
 * a background job. Transitions:
 *   open -> snoozed (snooze), open | snoozed -> resolved (resolve).
 * A resolved card never reopens and its resolution is never overwritten.
 */

export function effectiveState(
  exception: Pick<Exception, "state" | "snoozeUntil">,
  now: Date
): ExceptionState {
  if (exception.state !== "snoozed") return exception.state
  const until = exception.snoozeUntil ? Date.parse(exception.snoozeUntil) : NaN
  return Number.isFinite(until) && until > now.getTime() ? "snoozed" : "open"
}

/** Open, or snoozed past its expiry: needs a decision now. */
export const isActive = (exception: Exception, now: Date): boolean =>
  effectiveState(exception, now) === "open"

export function snoozed(
  exception: Exception,
  minutes: number,
  now: Date
): Exception {
  const state = effectiveState(exception, now)
  if (state === "resolved") {
    throw new ConflictError("This exception is already resolved.")
  }
  if (state === "snoozed") {
    throw new ConflictError("This exception is already snoozed.")
  }
  return {
    ...exception,
    state: "snoozed",
    snoozeUntil: new Date(now.getTime() + minutes * 60_000).toISOString(),
    updatedAt: now.toISOString(),
    version: exception.version + 1,
  }
}

export function resolved(
  exception: Exception,
  resolution: Omit<ExceptionResolution, "at">,
  now: Date
): Exception {
  if (exception.state === "resolved") {
    throw new ConflictError(
      "This exception is already resolved. Add a note instead."
    )
  }
  const { snoozeUntil: _dropped, ...rest } = exception
  void _dropped
  return {
    ...rest,
    state: "resolved",
    resolution: { ...resolution, at: now.toISOString() },
    updatedAt: now.toISOString(),
    version: exception.version + 1,
  }
}
