import { ShieldCheckIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"

import { HONEST_BOUNDARIES } from "@/lib/labels"

/** The honest-boundaries line (docs/solution.md Section 4, principle 7). */
export function HonestBoundaries({ detail }: { detail?: string }) {
  return (
    <Alert>
      <ShieldCheckIcon aria-hidden="true" />
      <AlertTitle>What VisitProof Shows</AlertTitle>
      <AlertDescription>
        {HONEST_BOUNDARIES}
        {detail ? ` ${detail}` : ""}
      </AlertDescription>
    </Alert>
  )
}
