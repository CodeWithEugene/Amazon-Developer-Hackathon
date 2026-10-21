import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleHelpIcon,
  ClockIcon,
  EyeOffIcon,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "warning"
  | "success"

interface StatusBadgeEntry {
  variant: BadgeVariant
  icon: typeof ClockIcon
  label: string
}

/** Visit statuses (mirrors `visitStatusSchema` in @visitproof/domain). */
export type VisitStatusKey =
  | "scheduled"
  | "awaiting_arrival"
  | "arrived_on_time"
  | "arrived_late"
  | "no_show"
  | "in_progress"
  | "completed"
  | "early_departure"
  | "departure_not_observed"
  | "unobservable"
  | "ambiguous"

/** Exception kinds (mirrors `exceptionKindSchema` in @visitproof/domain). */
export type ExceptionKindKey =
  | "late_no_arrival"
  | "late_arrival"
  | "no_show"
  | "early_departure"
  | "unobservable"
  | "contradicted"
  | "missing_clock_in"
  | "ambiguous"

/** Reconciliation outcomes (mirrors `reconciliationOutcomeSchema`). */
export type ReconciliationOutcomeKey =
  | "corroborated"
  | "corroborated_with_variance"
  | "contradicted"
  | "missing_clock_in"
  | "missing_door"
  | "missing_both"
  | "unobservable"
  | "pending"

/** Ring link states (mirrors `ringLinkStatusSchema`). */
export type RingLinkStatusKey =
  | "unlinked"
  | "awaiting"
  | "linked"
  | "paused"
  | "removed"

export type StatusKey =
  | VisitStatusKey
  | ExceptionKindKey
  | ReconciliationOutcomeKey
  | RingLinkStatusKey
  | "on_time"
  | "late"

const ok = (label: string): StatusBadgeEntry => ({
  variant: "default",
  icon: CircleCheckIcon,
  label,
})
const warn = (label: string): StatusBadgeEntry => ({
  variant: "warning",
  icon: ClockIcon,
  label,
})
const bad = (label: string): StatusBadgeEntry => ({
  variant: "destructive",
  icon: CircleAlertIcon,
  label,
})
const quiet = (label: string): StatusBadgeEntry => ({
  variant: "secondary",
  icon: EyeOffIcon,
  label,
})
const review = (label: string): StatusBadgeEntry => ({
  variant: "outline",
  icon: CircleHelpIcon,
  label,
})

/**
 * Status chip mapping from docs/build.md Section 9, single source. Typed as
 * an exhaustive record so a new domain status fails to compile until it has
 * a human label.
 */
const STATUS_BADGES: Record<StatusKey, StatusBadgeEntry> = {
  on_time: ok("On Time"),
  arrived_on_time: ok("On Time"),
  completed: ok("Completed"),
  corroborated: ok("Corroborated"),
  corroborated_with_variance: ok("Corroborated With Variance"),
  linked: ok("Ring Linked"),
  late: warn("Late"),
  arrived_late: warn("Late"),
  late_arrival: warn("Late Arrival"),
  late_no_arrival: warn("Late, No Arrival Yet"),
  early_departure: warn("Early Departure"),
  missing_clock_in: warn("Missing Clock-In"),
  no_show: bad("No Show"),
  contradicted: bad("Contradicted"),
  unobservable: quiet("Unobservable"),
  awaiting_arrival: quiet("Awaiting Arrival"),
  awaiting: quiet("Awaiting Family"),
  paused: quiet("Paused"),
  removed: quiet("Link Removed"),
  unlinked: quiet("Not Linked"),
  departure_not_observed: quiet("Departure Not Observed"),
  scheduled: { variant: "secondary", icon: CircleDotIcon, label: "Scheduled" },
  in_progress: {
    variant: "secondary",
    icon: CircleDotIcon,
    label: "In Progress",
  },
  ambiguous: review("Needs Review"),
  missing_door: review("Missing Door Data"),
  missing_both: review("Missing Both"),
  pending: review("Pending"),
}

const isStatusKey = (status: string): status is StatusKey =>
  Object.prototype.hasOwnProperty.call(STATUS_BADGES, status)

/** Human label for any status, kind, or outcome; never the raw enum. */
function statusLabel(status: string): string {
  if (isStatusKey(status)) return STATUS_BADGES[status].label
  return status
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function StatusBadge({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  const entry: StatusBadgeEntry = isStatusKey(status)
    ? STATUS_BADGES[status]
    : review(statusLabel(status))
  const Icon = entry.icon
  return (
    <Badge variant={entry.variant} className={className}>
      <Icon data-icon="inline-start" aria-hidden="true" />
      {entry.label}
      <span className="sr-only">Status: {entry.label}</span>
    </Badge>
  )
}

export { StatusBadge, STATUS_BADGES, statusLabel }
