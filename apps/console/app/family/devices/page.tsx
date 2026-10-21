import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { DeviceCheckCard } from "@/components/ring/device-check-card"
import { LiveModeEmpty } from "@/components/ring/live-mode-empty"
import { RingProvenanceBadge } from "@/components/ring/provenance-badge"
import { RingErrorAlert } from "@/components/ring/ring-error-alert"
import { SyncHistoryButton } from "@/components/ring/sync-history-button"
import { getRingMode } from "@/lib/ring/live"
import { loadDeviceChecks } from "@/lib/ring/views"
import { getSessionRole } from "@/lib/session"
import { getSessionClientId } from "@/lib/store"

export const metadata = { title: "Device Check" }

const DESCRIPTION =
  "Your doorbell settings, read live from Ring. VisitProof cannot change Ring settings, so every item says where to change it in the Ring app."

export default async function DeviceCheckPage() {
  const role = await getSessionRole()
  if (role !== "family") redirect("/")
  if (getRingMode() === "demo") {
    return (
      <PageShell role={role} width="narrow" title="Device Check" description={DESCRIPTION}>
        <LiveModeEmpty feature="Device Check" />
      </PageShell>
    )
  }
  const view = await loadDeviceChecks(await getSessionClientId())
  return (
    <PageShell role={role} width="narrow" title="Device Check" description={DESCRIPTION}>
      <div className="flex flex-col gap-4">
        {view.ok ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <RingProvenanceBadge source={view.source} label={view.provenanceLabel} />
              <SyncHistoryButton />
            </div>
            {view.data.length === 0 ? (
              <p className="text-muted-foreground">No devices are shared with VisitProof yet. Share the front door doorbell from the Ring app.</p>
            ) : (
              view.data.map((check) => <DeviceCheckCard key={check.deviceId} check={check} />)
            )}
          </>
        ) : (
          <RingErrorAlert error={view.error} />
        )}
      </div>
    </PageShell>
  )
}
