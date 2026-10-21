import { NextResponse } from "next/server"
import { z } from "zod"

import { rejectCrossSite, storeErrorResponse } from "@/lib/api"
import {
  addNote,
  getSessionCaregiverId,
  getSessionClientId,
  getVisit,
} from "@/lib/store"
import { getSessionRole } from "@/lib/session"

const noteSchema = z.object({
  visitId: z.string().min(1),
  text: z.string().trim().min(1).max(2000),
  classification: z.enum(["dispute", "explanation", "fyi"]).optional(),
})

/**
 * Notes are ledger-signed, so the visit must exist and belong to the
 * session's persona: caregivers note their own visits, families their own
 * client's, schedulers (agency staff) any visit on the roster.
 */
async function authorizeNoteTarget(
  role: "family" | "caregiver" | "scheduler",
  visitId: string
): Promise<NextResponse | null> {
  const visit = await getVisit(visitId)
  if (!visit) {
    return NextResponse.json({ error: "Visit not found" }, { status: 404 })
  }
  if (role === "caregiver" && visit.caregiverId !== (await getSessionCaregiverId())) {
    return NextResponse.json(
      { error: "You can only add notes to your own visits" },
      { status: 403 }
    )
  }
  if (role === "family" && visit.clientId !== (await getSessionClientId())) {
    return NextResponse.json(
      { error: "You can only add notes to your own household's visits" },
      { status: 403 }
    )
  }
  return null
}

/** POST adds a note from the signed-in family member or caregiver. */
export async function POST(request: Request) {
  const role = await getSessionRole()
  if (role !== "family" && role !== "caregiver" && role !== "scheduler") {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 })
  }
  const refused = rejectCrossSite(request)
  if (refused) return refused
  const parsed = noteSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid note" }, { status: 400 })
  }

  const denied = await authorizeNoteTarget(role, parsed.data.visitId)
  if (denied) return denied

  const authorRole =
    role === "scheduler"
      ? ("agency_staff" as const)
      : (role as "family" | "caregiver")
  try {
    const note = await addNote({
      ...parsed.data,
      authorRole,
      authorId: `demo-${role}`,
    })
    return NextResponse.json({ note })
  } catch (error) {
    return storeErrorResponse(error)
  }
}
