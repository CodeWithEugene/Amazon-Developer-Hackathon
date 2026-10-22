import { redirect } from "next/navigation"

import { ComplianceView } from "@/components/compliance-view"
import { PageShell } from "@/components/page-shell"
import { getSessionRole } from "@/lib/session"
import { zoneDescription } from "@/lib/time"
import { loadCompliance } from "@/lib/views/compliance"

export const metadata = { title: "Compliance" }

export default async function CompliancePage() {
  const role = await getSessionRole()
  if (role !== "compliance" && role !== "scheduler") {
    redirect("/")
  }
  const data = await loadCompliance()
  return (
    <PageShell
      role={role}
      title="Compliance"
      width="full"
      description={`Reconciliation against EVV clock-ins, signed evidence records, and exportable packs. Times in ${zoneDescription(new Date(), data.timeZone)}.`}
    >
      <ComplianceView data={data} />
    </PageShell>
  )
}
