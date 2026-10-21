import { redirect } from "next/navigation"

import { FamilyView } from "@/components/family-view"
import { PageShell } from "@/components/page-shell"
import { getSessionRole } from "@/lib/session"
import { loadFamily } from "@/lib/views/family"

export const metadata = { title: "Family" }

export default async function FamilyPage() {
  const role = await getSessionRole()
  if (role !== "family") {
    redirect("/")
  }
  // Demo persona: the first family on the agency roster (Grace Okoro's household).
  const data = await loadFamily()
  if (!data) {
    redirect("/?error=no-client")
  }
  return (
    <PageShell
      role={role}
      width="narrow"
      title={`${data.client.name}'s Home`}
      description="One calm message a day, alerts only when they matter, and full control over what is shared."
    >
      <FamilyView data={data} />
    </PageShell>
  )
}
