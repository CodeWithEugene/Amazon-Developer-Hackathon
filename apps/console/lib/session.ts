import "server-only"

import { cookies } from "next/headers"

import type { Role } from "@/lib/roles"
import { isRole } from "@/lib/roles"

export const SESSION_COOKIE = "vp_role"

export async function getSessionRole(): Promise<Role | null> {
  const jar = await cookies()
  const value = jar.get(SESSION_COOKIE)?.value
  return isRole(value) ? value : null
}
