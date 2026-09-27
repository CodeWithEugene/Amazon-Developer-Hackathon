import { redirect } from "next/navigation"

import { AppHeader } from "@/components/app-header"
import {
  ComplianceView,
  type ReconciliationRow,
} from "@/components/compliance-view"
import {
  listClients,
  listCaregivers,
  listEvvRecords,
  listLedgerRecords,
  listVisits,
  verifyLedgerRecords,
} from "@/lib/store"
import { getSessionRole } from "@/lib/session"

export const metadata = { title: "Compliance" }

export default async function CompliancePage() {
  const role = await getSessionRole()
  if (role !== "compliance" && role !== "scheduler") {
    redirect("/")
  }

  const [visits, evvRecords, clients, caregivers] = await Promise.all([
    listVisits(),
    listEvvRecords(),
    listClients(),
    listCaregivers(),
  ])
  const ledger = await listLedgerRecords(clients[0]?.id ?? "")
  // Actually verify the chain and signatures at render so the card never
  // claims a check that did not run.
  const chainVerified = verifyLedgerRecords(ledger)

  const rows: ReconciliationRow[] = visits.map((visit) => ({
    visit,
    clientName:
      clients.find((c) => c.id === visit.clientId)?.name ?? visit.clientId,
    caregiverName:
      caregivers.find((c) => c.id === visit.caregiverId)?.name ??
      visit.caregiverId,
    evv: evvRecords.find((e) => e.visitId === visit.id),
  }))

  return (
    <div className="min-h-svh bg-background">
      <AppHeader
        role={role}
        nav={[
          { href: "/agency/today", label: "Today" },
          { href: "/agency/compliance", label: "Compliance", active: true },
        ]}
      />
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-col gap-1">
          <h2 className="scroll-m-20 text-3xl font-semibold tracking-tight">
            Compliance
          </h2>
          <p className="text-muted-foreground">
            Reconciliation against EVV clock-ins, signed evidence records, and
            exportable packs.
          </p>
        </div>
        <ComplianceView
          rows={rows}
          ledger={ledger}
          chainVerified={chainVerified}
        />
      </main>
    </div>
  )
}
