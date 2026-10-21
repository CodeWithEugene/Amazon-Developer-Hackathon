import type {
  AuthorRole,
  BoundarySource,
  DoorEventType,
  EventProvenance,
  ExceptionKind,
  NarrativeProvenance,
  NoteClassification,
} from "@visitproof/domain"

/** Human labels for every enum shown on screen or in the PDF. */

export const PROVENANCE_LABELS: Record<EventProvenance, string> = {
  ring_webhook: "Ring Webhook",
  ring_history: "Ring Event History",
  playground: "Ring Playground Sandbox Device",
  emulated: "Emulated Event (Demo)",
}

/** Shown inline after narrative body text, so sentence case, not Title Case. */
export const NARRATIVE_PROVENANCE_LABELS: Record<NarrativeProvenance, string> = {
  template: "Written from a template",
  bedrock: "Written by Amazon Bedrock",
}

export const BOUNDARY_SOURCE_LABELS: Record<BoundarySource, string> = {
  rule: "Door Rule",
  jev: "Jev Judgment",
  manual: "Manual Entry",
}

export const AUTHOR_ROLE_LABELS: Record<AuthorRole, string> = {
  agency_admin: "Agency Admin",
  agency_staff: "Agency Staff",
  family: "Family",
  caregiver: "Caregiver",
  system: "VisitProof",
}

export const NOTE_CLASSIFICATION_LABELS: Record<NoteClassification, string> = {
  dispute: "Dispute",
  explanation: "Explanation",
  fyi: "Note",
}

export const DOOR_EVENT_LABELS: Record<DoorEventType, string> = {
  motion: "Motion",
  ding: "Doorbell Press",
  on_demand: "Live View Session",
  device_online: "Device Online",
  device_offline: "Device Offline",
  device_added: "Device Added",
  device_removed: "Device Removed",
  integration_added: "Integration Added",
  integration_removed: "Integration Removed",
  sensor: "Sensor",
}

const MOTION_SUBTYPE_LABELS: Record<string, string> = {
  human: "Person",
  vehicle: "Vehicle",
  animal: "Animal",
  other_motion: "Other Motion",
}

/** "Motion (Person)", "Doorbell Press". */
export function doorEventLabel(type: DoorEventType, subType?: string): string {
  const base = DOOR_EVENT_LABELS[type]
  if (!subType || subType === "button_press") return base
  return `${base} (${MOTION_SUBTYPE_LABELS[subType] ?? subType})`
}

/** Resolution reasons offered in the agency UI. */
export const RESOLVE_REASONS = [
  { value: "caregiver_confirmed", label: "Caregiver Confirmed Times" },
  { value: "family_confirmed", label: "Family Confirmed Times" },
  { value: "visit_completed", label: "Visit Completed As Scheduled" },
  { value: "traffic", label: "Traffic Or Transit Delay" },
  { value: "device_issue", label: "Device Issue, Visit Occurred" },
  { value: "visit_rescheduled", label: "Visit Rescheduled" },
] as const

const REASON_LABELS: Record<string, string> = {
  ...Object.fromEntries(RESOLVE_REASONS.map((r) => [r.value, r.label])),
  backfilled: "Times Backfilled",
  superseded: "Superseded By A Later Status",
  arrived_late: "Arrived Late",
}

/** Human label for a stored resolution reason; free text passes through. */
export function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason
}

/** Family-facing copy per exception kind; typed so a new kind fails to compile. */
export const FAMILY_EXCEPTION_TEXT: Record<ExceptionKind, string> = {
  late_arrival: "The caregiver arrived later than scheduled.",
  late_no_arrival: "The visit started with no arrival observed yet.",
  no_show: "No caregiver arrival was observed at the door.",
  early_departure: "The caregiver left earlier than scheduled.",
  unobservable: "The doorbell could not observe the visit.",
  contradicted: "A clock-in was reported that does not match the door.",
  missing_clock_in: "No clock-in was recorded for the visit.",
  ambiguous: "The visit needs a person to review it.",
}

/** Agency-facing copy per exception kind. */
export const AGENCY_EXCEPTION_TEXT: Record<ExceptionKind, string> = {
  late_arrival: "The caregiver arrived after the grace period.",
  late_no_arrival: "No arrival observed and the grace period has passed.",
  no_show: "No arrival or departure was observed for this visit.",
  early_departure: "The caregiver left before the scheduled end.",
  unobservable: "The doorbell could not observe this visit.",
  contradicted: "The EVV clock-in contradicts the observed arrival.",
  missing_clock_in: "No EVV clock-in was recorded for this visit.",
  ambiguous: "Multiple arrivals were observed and a person needs to decide.",
}

export const HONEST_BOUNDARIES =
  "VisitProof shows that a person arrived at the door. It never identifies who."
