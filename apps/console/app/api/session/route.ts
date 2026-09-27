import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { isRole } from "@/lib/roles"
import { SESSION_COOKIE } from "@/lib/session"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { role?: string } | null
  if (!isRole(body?.role)) {
    return NextResponse.json({ error: "Unknown role" }, { status: 400 })
  }
  const jar = await cookies()
  jar.set(SESSION_COOKIE, body.role, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  })
  return NextResponse.json({ role: body.role })
}

export async function DELETE() {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
  return NextResponse.json({ ok: true })
}
