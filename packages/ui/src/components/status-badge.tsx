import {
  CircleAlertIcon,
  CircleCheckIcon,
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

/** Status chip mapping from docs/build.md Section 9, single source. */
const STATUS_BADGES: Record<string, { variant: BadgeVariant; icon: typeof ClockIcon; label: string }> = {
  on_time: { variant: "default", icon: CircleCheckIcon, label: "On Time" },
  arrived_on_time: { variant: "default", icon: CircleCheckIcon, label: "On Time" },
  completed: { variant: "success", icon: CircleCheckIcon, label: "Completed" },
  corroborated: { variant: "success", icon: CircleCheckIcon, label: "Corroborated" },
  corroborated_with_variance: { variant: "success", icon: CircleCheckIcon, label: "Corroborated (Variance)" },
  late: { variant: "warning", icon: ClockIcon, label: "Late" },
  arrived_late: { variant: "warning", icon: ClockIcon, label: "Late" },
  early_departure: { variant: "warning", icon: ClockIcon, label: "Early Departure" },
  missing_clock_in: { variant: "warning", icon: ClockIcon, label: "Missing Clock-In" },
  late_no_arrival: { variant: "warning", icon: ClockIcon, label: "Late, No Arrival" },
  no_show: { variant: "destructive", icon: CircleAlertIcon, label: "No Show" },
  contradicted: { variant: "destructive", icon: CircleAlertIcon, label: "Contradicted" },
  unobservable: { variant: "secondary", icon: EyeOffIcon, label: "Unobservable" },
  awaiting_arrival: { variant: "secondary", icon: EyeOffIcon, label: "Awaiting" },
  paused: { variant: "secondary", icon: EyeOffIcon, label: "Paused" },
  departure_not_observed: { variant: "secondary", icon: EyeOffIcon, label: "Departure Not Observed" },
  ambiguous: { variant: "outline", icon: CircleHelpIcon, label: "Needs Review" },
  missing_door: { variant: "outline", icon: CircleHelpIcon, label: "Missing Door Data" },
  missing_both: { variant: "outline", icon: CircleHelpIcon, label: "Missing Both" },
  pending: { variant: "outline", icon: CircleHelpIcon, label: "Pending" },
}

function StatusBadge({ status, className }: { status: string; className?: string }) {
  const entry = STATUS_BADGES[status] ?? {
    variant: "outline" as BadgeVariant,
    icon: CircleHelpIcon,
    label: status,
  }
  const Icon = entry.icon
  return (
    <Badge variant={entry.variant} className={className}>
      <Icon data-icon="inline-start" aria-hidden="true" />
      {entry.label}
      <span className="sr-only">Status: {entry.label}</span>
    </Badge>
  )
}

export { StatusBadge, STATUS_BADGES }
