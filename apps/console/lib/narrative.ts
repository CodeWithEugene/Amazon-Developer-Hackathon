import type { Visit } from "@visitproof/domain"

import { NARRATIVE_PROVENANCE_LABELS } from "@/lib/labels"
import { formatLocalTime } from "@/lib/time"

export interface DisplayNarrative {
  text: string
  provenance: string
}

const UTC_CLOCK = /\b([01]\d|2[0-3]):([0-5]\d)\b/g
const HAS_MERIDIEM = /\b(AM|PM)\b/

/**
 * The stored narrative, shown in the agency time zone. Template narratives
 * written before the engine knew the agency zone carry 24-hour UTC clock
 * times ("09:00"); those tokens are re-rendered on the visit's UTC day as
 * agency-local 12-hour times. Text that already uses AM or PM is shown as
 * written.
 */
export function displayNarrative(
  visit: Visit,
  timeZone: string
): DisplayNarrative | null {
  const narrative = visit.narrative
  if (!narrative) return null
  const provenance = NARRATIVE_PROVENANCE_LABELS[narrative.provenance]
  if (narrative.provenance !== "template" || HAS_MERIDIEM.test(narrative.text)) {
    return { text: narrative.text, provenance }
  }
  const utcDay = visit.scheduledStart.slice(0, 10)
  const text = narrative.text.replace(UTC_CLOCK, (_match, hh: string, mm: string) =>
    formatLocalTime(`${utcDay}T${hh}:${mm}:00Z`, timeZone)
  )
  return { text, provenance }
}
