import { NextResponse } from "next/server"
import { z } from "zod"

import { storeErrorResponse } from "@/lib/api"
import {
  agencyCanSee,
  buildEvidencePackPdf,
  listClients,
  toOpenEvvExport,
} from "@/lib/store"
import { getSessionRole } from "@/lib/session"

const querySchema = z.object({
  format: z.enum(["pdf", "json"]).default("json"),
  clientId: z.string().min(1).max(200).optional(),
})

const fileSlug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

/**
 * GET /api/compliance/export?format=pdf|json&clientId=<id>. The PDF is one
 * client's Evidence Pack (default: the first client that shares with the
 * agency); the JSON is the agency's Alternate EVV export for every sharing
 * client.
 */
export async function GET(request: Request) {
  const role = await getSessionRole()
  if (role !== "compliance" && role !== "scheduler") {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 })
  }
  const url = new URL(request.url)
  const parsed = querySchema.safeParse({
    format: url.searchParams.get("format") ?? undefined,
    clientId: url.searchParams.get("clientId") ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid export request" }, { status: 400 })
  }
  try {
    if (parsed.data.format === "pdf") return await pdfResponse(parsed.data.clientId)
    return new NextResponse(await toOpenEvvExport(), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="visitproof-evv-export.json"`,
      },
    })
  } catch (error) {
    return storeErrorResponse(error)
  }
}

async function pdfResponse(clientId: string | undefined): Promise<NextResponse> {
  const clients = await listClients()
  const client = clientId
    ? clients.find((c) => c.id === clientId)
    : clients.find(agencyCanSee)
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 })
  }
  const pdf = await buildEvidencePackPdf(client.id)
  return new NextResponse(pdf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="visitproof-evidence-pack-${fileSlug(client.name)}.pdf"`,
    },
  })
}
