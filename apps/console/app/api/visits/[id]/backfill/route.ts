import { NextResponse } from "next/server"
import { z } from "zod"

import { storeErrorResponse } from "@/lib/api"
import { backfillVisit } from "@/lib/store"
import { getSessionRole } from "@/lib/session"

const backfillSchema = z
  .object({
    arrivalAt: z.iso.datetime().optional(),
    departureAt: z.iso.datetime().optional(),
    reason: z.string().trim().min(1).max(200).optional(),
  })
  .refine((body) => body.arrivalAt || body.departureAt, {
    message: "At least one of arrivalAt or departureAt is required",
  })

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const role = await getSessionRole()
  if (role !== "scheduler" && role !== "compliance") {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 })
  }
  const { id } = await params
  const parsed = backfillSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid backfill" },
      { status: 400 }
    )
  }
  try {
    const visit = await backfillVisit(id, parsed.data, role)
    return NextResponse.json({ visit })
  } catch (error) {
    return storeErrorResponse(error)
  }
}
