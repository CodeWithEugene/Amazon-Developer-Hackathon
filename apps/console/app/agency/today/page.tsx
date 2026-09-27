import { redirect } from "next/navigation"

import { AppHeader } from "@/components/app-header"
import {
  TodayBoard,
  type ExceptionRow,
  type VisitRow,
} from "@/components/today-board"
import { formatWindow } from "@/lib/format"
import {
  listClients,
  listCaregivers,
  listExceptions,
  listVisits,
} from "@/lib/store"
import { getSessionRole } from "@/lib/session"

export const metadata = { title: "Agency Today" }

export default async function TodayPage() {
  const role = await getSessionRole()
  if (role !== "scheduler" && role !== "compliance") {
    redirect("/")
  }

  const [visits, exceptions, clients, caregivers] = await Promise.all([
    listVisits(),
    listExceptions(["open"]),
    listClients(),
    listCaregivers(),
  ])

  const clientName = (id: string): string =>
    clients.find((c) => c.id === id)?.name ?? id
  const caregiverName = (id: string): string =>
    caregivers.find((c) => c.id === id)?.name ?? id

  const rows: VisitRow[] = visits.map((visit) => ({
    visit,
    clientName: clientName(visit.clientId),
    caregiverName: caregiverName(visit.caregiverId),
  }))

  const exceptionRows: ExceptionRow[] = exceptions.map((exception) => {
    const visit = visits.find((v) => v.id === exception.visitId)
    const caregiver = visit
      ? caregivers.find((c) => c.id === visit.caregiverId)
      : undefined
    return {
      exception,
      clientName: clientName(exception.clientId),
      caregiverName: caregiver?.name ?? "Unknown",
      visitWindow: visit
        ? formatWindow(visit.scheduledStart, visit.scheduledEnd)
        : "Unknown window",
      ...(caregiver?.mobile ? { caregiverMobile: caregiver.mobile } : {}),
    }
  })

  return (
    <div className="min-h-svh bg-background">
      <AppHeader
        role={role}
        nav={[
          { href: "/agency/today", label: "Today", active: true },
          { href: "/agency/compliance", label: "Compliance" },
        ]}
      />
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-col gap-1">
          <h2 className="scroll-m-20 text-3xl font-semibold tracking-tight">
            Agency Today
          </h2>
          <p className="text-muted-foreground">
            Live visit status from the doorbell, and exceptions that need a
            decision.
          </p>
        </div>
        <TodayBoard
          rows={rows}
          exceptions={exceptionRows}
          stats={{
            visitsToday: visits.length,
            inProgress: visits.filter((v) => v.status === "in_progress").length,
            openExceptions: exceptions.length,
            unlinkedClients: clients.filter(
              (c) => c.ringLinkStatus !== "linked"
            ).length,
          }}
        />
      </main>
    </div>
  )
}
