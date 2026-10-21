import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { TodayBoard } from "@/components/today-board"
import { getSessionRole } from "@/lib/session"
import { zoneAbbreviation } from "@/lib/time"
import { loadTodayBoard } from "@/lib/views/today"

export const metadata = { title: "Agency Today" }

export default async function TodayPage() {
  const role = await getSessionRole()
  if (role !== "scheduler" && role !== "compliance") {
    redirect("/")
  }
  const data = await loadTodayBoard()
  return (
    <PageShell
      role={role}
      title="Agency Today"
      description={`${data.todayLabel}. Live visit status from the doorbell, and exceptions that need a decision.`}
    >
      <TodayBoard
        data={data}
        timeZoneLabel={`${zoneAbbreviation(new Date(), data.timeZone)} (${data.timeZone})`}
      />
    </PageShell>
  )
}
