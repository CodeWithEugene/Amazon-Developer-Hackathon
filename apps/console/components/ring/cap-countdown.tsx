import { TimerIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@workspace/ui/components/progress"

/**
 * Time left before Ring's session cap (30 s battery, 60 s wired): a
 * registry Progress bar with a label and value, plus a Badge in a polite
 * live region for screen readers.
 */
export function CapCountdown({
  remainingMs,
  totalMs,
}: {
  remainingMs: number
  totalMs: number
}) {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1_000))
  const total = Math.max(1, Math.round(totalMs / 1_000))
  return (
    <div className="flex flex-col gap-2">
      <Progress
        value={Math.min(100, (seconds / total) * 100)}
        aria-valuetext={`${seconds} seconds left`}
      >
        <ProgressLabel>Live View Time Left</ProgressLabel>
        <ProgressValue>{() => `${seconds} of ${total} seconds`}</ProgressValue>
      </Progress>
      <div className="flex items-center gap-2" aria-live="polite">
        <Badge variant={seconds <= 10 ? "warning" : "secondary"}>
          <TimerIcon data-icon="inline-start" aria-hidden="true" />
          {seconds} Seconds Left
        </Badge>
        <span className="text-sm text-muted-foreground">
          Ring ends live view after {total} seconds.
        </span>
      </div>
    </div>
  )
}
