import { historyEventTimeIso, type HistoryEvent } from "@visitproof/ring-partner-sdk"

/**
 * One line for the history step of `pnpm ring:smoke`. Event times come from
 * `historyEventTimeIso`, which turns the live API's epoch millisecond
 * `start` (or the documented `timestamp`) into ISO 8601.
 */
export const historySummary = (events: readonly HistoryEvent[], hasNext: boolean): string => {
  if (events.length === 0) return "0 events (Ring returned no events for this device since consent)"
  const types = [...new Set(events.map((event) => event.attributes.event_type))].join(", ")
  const times = events.map(historyEventTimeIso).sort()
  const range = times.length === 1 ? times[0] : `${times[0]} to ${times[times.length - 1]}`
  return `${events.length} events on the first page, types ${types}, ${range}, next page ${hasNext ? "yes" : "no"}`
}
