import "server-only"

import { cookies } from "next/headers"

import type { Role } from "@/lib/roles"
import { verifySessionToken } from "@/lib/session-token"

export const SESSION_COOKIE = "vp_role"

export async function getSessionRole(): Promise<Role | null> {
  const jar = await cookies()
  return verifySessionToken(jar.get(SESSION_COOKIE)?.value)
}
