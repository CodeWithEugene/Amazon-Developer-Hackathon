import { TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"

import type { RingViewError } from "@/lib/ring/views"

const TITLES: Readonly<Record<RingViewError["code"], string>> = {
  live_mode_off: "Live Mode Is Off",
  token_expired: "Ring Token Expired",
  not_linked: "Ring Is Not Linked Yet",
  misconfigured: "Ring Is Not Configured",
  device_unavailable: "Doorbell Unavailable",
  device_not_found: "Device Not Shared",
  ring_error: "Ring Did Not Respond",
}

export function RingErrorAlert({ error }: { error: RingViewError }) {
  return (
    <Alert variant={error.code === "device_unavailable" ? "warning" : "destructive"}>
      <TriangleAlertIcon aria-hidden="true" />
      <AlertTitle>{TITLES[error.code]}</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  )
}
