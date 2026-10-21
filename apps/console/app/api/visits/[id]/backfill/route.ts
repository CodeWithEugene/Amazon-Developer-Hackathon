import { NextResponse } from "next/server"
import { z } from "zod"

import { rejectCrossSite, storeErrorResponse } from "@/lib/api"
import { recordAgencyCorrection } from "@/lib/store"
import { getSessionRole } from "@/lib/session"

const wallTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM")

/**
 * Backfill Times records an agency correction (contract C2). Times arrive
 * as agency-local wall times on the visit's own day (`arrivalLocal`,
 * `departureLocal`) or as ISO instants; the door's observed times are
 * never overwritten.
 */
const backfillSchema = z
  .object({
    arrivalAt: z.iso.datetime({ offset: true }).optional(),
    departureAt: z.iso.datetime({ offset: true }).optional(),
    arrivalLocal: wallTime.optional(),
    departureLocal: wallTime.optional(),
    reason: z.string().trim().min(1).max(200).optional(),
    note: z.string().trim().min(1).max(2000).optional(),
    exceptionId: z.string().min(1).max(200).optional(),
  })
  .refine(
    (body) =>
      body.arrivalAt || body.departureAt || body.arrivalLocal || body.departureLocal,
    { message: "Enter an arrival time, a departure time, or both." }
  )

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const role = await getSessionRole()
  if (role !== "scheduler" && role !== "compliance") {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 })
  }
  const refused = rejectCrossSite(request)
  if (refused) return refused
  const { id } = await params
  const parsed = backfillSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid backfill" },
      { status: 400 }
    )
  }
  try {
    const result = await recordAgencyCorrection(id, parsed.data, role)
    return NextResponse.json(result)
  } catch (error) {
    return storeErrorResponse(error)
  }
}
