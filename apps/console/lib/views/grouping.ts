import { addDaysToKey } from "@/lib/time"

/** Board groups, in display order. */
export type ExceptionGroup = "today" | "week" | "older" | "snoozed"

export const EXCEPTION_GROUP_TITLES: Record<ExceptionGroup, string> = {
  today: "Today",
  week: "Earlier This Week",
  older: "Older",
  snoozed: "Snoozed",
}

/**
 * Places an exception card: snoozed cards wait in their own group; open
 * cards go under Today, Earlier This Week (the six days before today), or
 * Older, by the agency-local date of their visit.
 */
export function exceptionGroup(
  visitDay: string | null,
  today: string,
  snoozedNow: boolean
): ExceptionGroup {
  if (snoozedNow) return "snoozed"
  if (!visitDay) return "older"
  if (visitDay >= today) return "today"
  return visitDay >= addDaysToKey(today, -6) ? "week" : "older"
}
