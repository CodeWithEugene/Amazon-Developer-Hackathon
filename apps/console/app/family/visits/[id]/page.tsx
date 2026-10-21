import { redirect } from "next/navigation"

import { VisitRecordPage } from "@/components/visit-record-page"
import { getSessionRole } from "@/lib/session"

export const metadata = { title: "Visit Record" }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const role = await getSessionRole()
  if (!role || (role !== "family")) {
    redirect("/")
  }
  const { id } = await params
  return <VisitRecordPage role={role} visitId={decodeURIComponent(id)} backHref="/family" />
}
