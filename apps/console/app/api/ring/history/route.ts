import { NextResponse } from "next/server"

import { rejectCrossSite } from "@/lib/api"
import { requireFamilyClient, ringErrorResponse } from "@/lib/ring/http"
import { syncRingHistory } from "@/lib/ring/history-sync"
import { getRingClient } from "@/lib/ring/live"
import { AGENCY_ID, getStore } from "@/lib/store"

const DEFAULT_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000

/**
 * "Sync Ring History": pulls history events since consent from the live
 * Ring Partner API and saves them as `ring_history` door events.
 */
export async function POST(request: Request) {
  const refused = rejectCrossSite(request, { requireJson: false })
  if (refused) return refused
  const family = await requireFamilyClient()
  if ("response" in family) return family.response
  const repository = getStore()
  const client = await repository.clients.get(AGENCY_ID, family.clientId)
  if (client?.ringLinkStatus === "removed") {
    return NextResponse.json({ error: "Ring sharing was removed for this household." }, { status: 409 })
  }
  const now = new Date()
  const consentedAt = client?.consent.consentedAt ? Date.parse(client.consent.consentedAt) : Number.NaN
  const sinceMs = Number.isFinite(consentedAt) ? consentedAt : now.getTime() - DEFAULT_LOOKBACK_MS
  let source: "playground" | "linked" = "playground"
  try {
    const live = await getRingClient({ clientId: family.clientId })
    source = live.source
    const result = await syncRingHistory({ ring: live.client, repository, clientId: family.clientId, sinceMs, now })
    return NextResponse.json({ result, provenance: live.provenanceLabel })
  } catch (error) {
    return ringErrorResponse(error, source)
  }
}
