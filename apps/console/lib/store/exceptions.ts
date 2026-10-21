import "server-only"

import type { Exception, ExceptionResolution } from "@visitproof/domain"

import { notFound } from "./errors"
import { resolved, snoozed } from "./exception-state"
import { appendLedger } from "./ledger"
import { AGENCY_ID, getStore } from "./repository"

/**
 * Resolves an open or snoozed exception. The signed ledger record is
 * appended first, so a state change never exists without its evidence;
 * a second resolve is refused (409) instead of overwriting the first.
 */
export async function resolveException(
  exceptionId: string,
  resolution: Omit<ExceptionResolution, "at">
): Promise<Exception> {
  const store = getStore()
  const exception =
    (await store.exceptions.get(AGENCY_ID, exceptionId)) ??
    notFound("Exception")
  const now = new Date()
  const updated = resolved(exception, resolution, now)
  await appendLedger(store, exception.clientId, "resolved", exceptionId, {
    action: "resolve",
    previousState: exception.state,
    by: resolution.by,
    reason: resolution.reason,
    note: resolution.note ?? null,
  })
  await store.exceptions.put(updated)
  return updated
}

/**
 * Snoozes an open exception. The snooze is ledgered; the card reappears on
 * the board when `snoozeUntil` passes (see `effectiveState`).
 */
export async function snoozeException(
  exceptionId: string,
  minutes: number,
  actor: string = "agency"
): Promise<Exception> {
  const store = getStore()
  const exception =
    (await store.exceptions.get(AGENCY_ID, exceptionId)) ??
    notFound("Exception")
  const updated = snoozed(exception, minutes, new Date())
  await appendLedger(store, exception.clientId, "resolved", exceptionId, {
    action: "snooze",
    by: actor,
    minutes,
    snoozeUntil: updated.snoozeUntil ?? null,
  })
  await store.exceptions.put(updated)
  return updated
}
