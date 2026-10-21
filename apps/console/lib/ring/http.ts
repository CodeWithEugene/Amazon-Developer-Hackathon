import "server-only"

import { NextResponse } from "next/server"

import { getSessionClientId } from "@/lib/store"
import { getSessionRole } from "@/lib/session"

import { toRingLiveError } from "./errors"
import type { RingSource } from "./live"

/** Shared helpers for the /api/ring/* route handlers. */

export const ringErrorResponse = (error: unknown, source: RingSource = "playground"): NextResponse => {
  const live = toRingLiveError(error, source)
  if (live.code === "ring_error") {
    process.stderr.write(
      `${JSON.stringify({ level: "error", service: "console", message: "ring call failed", cause: String(live.cause) })}\n`
    )
  }
  return NextResponse.json({ error: live.message, code: live.code }, { status: live.status })
}

/** The family session's client id, or the response to send instead. */
export const requireFamilyClient = async (): Promise<{ clientId: string } | { response: NextResponse }> => {
  if ((await getSessionRole()) !== "family") {
    return { response: NextResponse.json({ error: "Sign in as the family first." }, { status: 401 }) }
  }
  const clientId = await getSessionClientId()
  if (!clientId) {
    return { response: NextResponse.json({ error: "No household is set up yet." }, { status: 404 }) }
  }
  return { clientId }
}
