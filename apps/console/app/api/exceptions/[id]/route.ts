import { NextResponse } from "next/server"
import { z } from "zod"

import { storeErrorResponse } from "@/lib/api"
import { resolveException, snoozeException } from "@/lib/store"
import { getSessionRole } from "@/lib/session"

const actionSchema = z.object({
  action: z.enum(["resolve", "snooze"]).default("resolve"),
  reason: z.string().trim().min(1).max(200).optional(),
  note: z.string().trim().min(1).max(2000).optional(),
  minutes: z.number().int().min(1).max(120).optional(),
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
  const parsed = actionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid exception action" },
      { status: 400 }
    )
  }
  const body = parsed.data

  try {
    if (body.action === "snooze") {
      const exception = await snoozeException(id, body.minutes ?? 10)
      return NextResponse.json({ exception })
    }

    if (!body.reason) {
      return NextResponse.json(
        { error: "A reason is required" },
        { status: 400 }
      )
    }
    const exception = await resolveException(id, {
      by: role,
      reason: body.reason,
      ...(body.note ? { note: body.note } : {}),
    })
    return NextResponse.json({ exception })
  } catch (error) {
    return storeErrorResponse(error)
  }
}
