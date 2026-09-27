import { redirect } from "next/navigation"

import { AppHeader } from "@/components/app-header"
import { CaregiverView } from "@/components/caregiver-view"
import {
  getSessionCaregiverId,
  listClients,
  listNotes,
  listVisits,
} from "@/lib/store"
import { getSessionRole } from "@/lib/session"

export const metadata = { title: "My Visit Record" }

export default async function CaregiverPage() {
  const role = await getSessionRole()
  if (role !== "caregiver") {
    redirect("/")
  }

  // Demo persona: the caregiver with the most visits on record (never empty after seeding).
  const caregiverId = await getSessionCaregiverId()
  if (!caregiverId) {
    redirect("/")
  }
  const [visits, clients] = await Promise.all([listVisits(), listClients()])
  const myVisits = visits
    .filter((v) => v.caregiverId === caregiverId)
    .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))
  const rows = myVisits.map((visit) => ({
    visit,
    clientName:
      clients.find((c) => c.id === visit.clientId)?.name ?? visit.clientId,
  }))
  const active = myVisits.at(-1)
  const notes = active ? await listNotes(active.id) : []

  return (
    <div className="min-h-svh bg-background">
      <AppHeader role={role} />
      <main className="mx-auto w-full max-w-2xl px-4 py-8">
        <div className="mb-6 flex flex-col gap-1">
          <h2 className="scroll-m-20 text-3xl font-semibold tracking-tight">
            My Visit Record
          </h2>
          <p className="text-muted-foreground">
            Your own visits with the times the doorbell observed, and a place to
            add your side of the story.
          </p>
        </div>
        <CaregiverView visits={rows} notes={notes} />
      </main>
    </div>
  )
}
