import { redirect } from "next/navigation"

import { CaregiverView } from "@/components/caregiver-view"
import { PageShell } from "@/components/page-shell"
import { getSessionRole } from "@/lib/session"
import { loadCaregiver } from "@/lib/views/caregiver"

export const metadata = { title: "My Visit Record" }

export default async function CaregiverPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const role = await getSessionRole()
  if (role !== "caregiver") {
    redirect("/")
  }
  const visit = (await searchParams).visit
  // Demo persona: the caregiver with a missing clock-in with door presence.
  const data = await loadCaregiver(typeof visit === "string" ? visit : undefined)
  if (!data) {
    redirect("/?error=no-caregiver")
  }
  return (
    <PageShell
      role={role}
      width="narrow"
      title="My Visit Record"
      description={`Signed in as ${data.caregiverName}. Your own visits with the times the doorbell observed, and a place to add your side of the story.`}
    >
      <CaregiverView data={data} />
    </PageShell>
  )
}
