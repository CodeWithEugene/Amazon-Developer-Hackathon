import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { LiveModeEmpty } from "@/components/ring/live-mode-empty"
import { LiveView } from "@/components/ring/live-view"
import { RingProvenanceBadge } from "@/components/ring/provenance-badge"
import { RingErrorAlert } from "@/components/ring/ring-error-alert"
import { getRingMode } from "@/lib/ring/live"
import { loadLiveDevices } from "@/lib/ring/views"
import { getSessionRole } from "@/lib/session"
import { getSessionClientId } from "@/lib/store"

export const metadata = { title: "Live View" }

const DESCRIPTION =
  "A short look at the front door, straight from Ring. Live view is never recorded by VisitProof and stops on its own at Ring's time limit."

export default async function LiveViewPage() {
  const role = await getSessionRole()
  if (role !== "family") redirect("/")
  if (getRingMode() === "demo") {
    return (
      <PageShell role={role} width="narrow" title="Live View" description={DESCRIPTION}>
        <LiveModeEmpty feature="Live View" />
      </PageShell>
    )
  }
  const view = await loadLiveDevices(await getSessionClientId())
  return (
    <PageShell role={role} width="narrow" title="Live View" description={DESCRIPTION}>
      {view.ok ? (
        <div className="flex flex-col gap-4">
          <RingProvenanceBadge source={view.source} label={view.provenanceLabel} />
          {view.data.length === 0 ? (
            <p className="text-muted-foreground">No devices are shared with VisitProof yet.</p>
          ) : (
            <LiveView devices={view.data} provenanceLabel={view.provenanceLabel} source={view.source} />
          )}
        </div>
      ) : (
        <RingErrorAlert error={view.error} />
      )}
    </PageShell>
  )
}
