import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"

import { rejectCrossSite } from "@/lib/api"
import { ROLES } from "@/lib/roles"
import { SESSION_COOKIE } from "@/lib/session"
import { createSessionToken, SESSION_TTL_SECONDS } from "@/lib/session-token"

const sessionSchema = z.object({ role: z.enum(ROLES) })

/** Demo sign-in: one click per role, signed cookie, local demo data only. */
export async function POST(request: Request) {
  const refused = rejectCrossSite(request)
  if (refused) return refused
  const parsed = sessionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown role" }, { status: 400 })
  }
  const jar = await cookies()
  jar.set(SESSION_COOKIE, createSessionToken(parsed.data.role), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  })
  return NextResponse.json({ role: parsed.data.role })
}

export async function DELETE(request: Request) {
  const refused = rejectCrossSite(request, { requireJson: false })
  if (refused) return refused
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
  return NextResponse.json({ ok: true })
}
