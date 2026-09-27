import { NextResponse } from "next/server"
import { z } from "zod"

import { storeErrorResponse } from "@/lib/api"
import { getSessionClientId, updateConsent } from "@/lib/store"
import { getSessionRole } from "@/lib/session"

const patchSchema = z.object({
  clientId: z.string().min(1),
  shareWithAgency: z.boolean().optional(),
  snapshotsEnabled: z.boolean().optional(),
  snapshotRetentionDays: z.number().int().positive().max(90).optional(),
  exceptionAlerts: z.boolean().optional(),
})

export async function PATCH(request: Request) {
  const role = await getSessionRole()
  if (role !== "family") {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 })
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid consent patch" },
      { status: 400 }
    )
  }
  const { clientId, ...patch } = parsed.data
  // The family session is bound to its roster client; anything else is an IDOR.
  const sessionClientId = await getSessionClientId()
  if (!sessionClientId || clientId !== sessionClientId) {
    return NextResponse.json(
      { error: "You can only change consent for your own household" },
      { status: 403 }
    )
  }
  try {
    const client = await updateConsent(clientId, patch)
    return NextResponse.json({ consent: client.consent })
  } catch (error) {
    return storeErrorResponse(error)
  }
}
