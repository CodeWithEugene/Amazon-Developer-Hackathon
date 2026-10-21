import { FlaskConicalIcon, LinkIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"

/** Provenance label for live Ring data (solution.md Section 7: provenance everywhere). */
export function RingProvenanceBadge({ source, label }: { source: "playground" | "linked"; label: string }) {
  const Icon = source === "playground" ? FlaskConicalIcon : LinkIcon
  return (
    <Badge variant="outline">
      <Icon data-icon="inline-start" aria-hidden="true" />
      {label}
    </Badge>
  )
}
