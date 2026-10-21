import { NextResponse } from "next/server"
import { z } from "zod"

import { whepCapFor } from "@visitproof/ring-partner-sdk"

import { rejectCrossSite } from "@/lib/api"
import { requireFamilyClient, ringErrorResponse } from "@/lib/ring/http"
import { getRingClient, type RingSource } from "@/lib/ring/live"
import { getStreamRegistry } from "@/lib/ring/stream-registry"

/**
 * WHEP stream proxy (docs/build.md 5.2). The browser sends its recvonly SDP
 * offer; the server calls Ring's WHEP endpoint (browsers are blocked by
 * CORS), keeps the Ring session URL server-side, and returns the SDP answer
 * with an opaque session URL on this route. DELETE stops the session; the
 * registry also stops it right after the 30 s or 60 s cap.
 */

const startSchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  sdpOffer: z.string().min(10).max(100_000).startsWith("v=0"),
})

export async function POST(request: Request) {
  const refused = rejectCrossSite(request)
  if (refused) return refused
  const family = await requireFamilyClient()
  if ("response" in family) return family.response
  const parsed = startSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Send deviceId and an SDP offer." }, { status: 400 })
  let source: RingSource = "playground"
  try {
    const live = await getRingClient({ clientId: family.clientId })
    source = live.source
    const device = await live.client.device(parsed.data.deviceId)
    const capMs = whepCapFor(device.data.attributes.battery_powered)
    const answer = await live.client.whepStart(parsed.data.deviceId, parsed.data.sdpOffer)
    const session = getStreamRegistry(live.client).start({
      deviceId: parsed.data.deviceId,
      ringSessionUrl: answer.sessionUrl,
      capMs,
    })
    return NextResponse.json({
      sdpAnswer: answer.sdpAnswer,
      sessionUrl: `/api/ring/stream?id=${encodeURIComponent(session.id)}`,
      capMs,
      provenance: live.provenanceLabel,
    })
  } catch (error) {
    return ringErrorResponse(error, source)
  }
}

export async function DELETE(request: Request) {
  const refused = rejectCrossSite(request, { requireJson: false })
  if (refused) return refused
  const family = await requireFamilyClient()
  if ("response" in family) return family.response
  const id = new URL(request.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "Missing session id." }, { status: 400 })
  await getStreamRegistry().end(id)
  return new NextResponse(null, { status: 204 })
}
