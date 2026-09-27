import { redirect } from "next/navigation"

import { AppHeader } from "@/components/app-header"
import { FamilyView } from "@/components/family-view"
import {
  getSessionClientId,
  listClients,
  listExceptions,
  listVisits,
} from "@/lib/store"
import { getSessionRole } from "@/lib/session"

export const metadata = { title: "Family" }

export default async function FamilyPage() {
  const role = await getSessionRole()
  if (role !== "family") {
    redirect("/")
  }

  // Demo persona: the first family on the agency roster (Grace Okoro's household).
  const clientId = await getSessionClientId()
  const client = (await listClients()).find((c) => c.id === clientId)
  if (!client) {
    redirect("/")
  }
  const [visits, exceptions] = await Promise.all([
    listVisits(),
    listExceptions(["open"]),
  ])
  const visit = visits.find((v) => v.clientId === client.id) ?? null
  const clientExceptions = exceptions.filter((e) => e.clientId === client.id)

  return (
    <div className="min-h-svh bg-background">
      <AppHeader role={role} />
      <main className="mx-auto w-full max-w-2xl px-4 py-8">
        <div className="mb-6 flex flex-col gap-1">
          <h2 className="scroll-m-20 text-3xl font-semibold tracking-tight">
            {client.name}&apos;s Home
          </h2>
          <p className="text-muted-foreground">
            One calm message a day, alerts only when they matter, and full
            control over what is shared.
          </p>
        </div>
        <FamilyView
          client={client}
          visit={visit}
          exceptions={clientExceptions}
        />
      </main>
    </div>
  )
}
