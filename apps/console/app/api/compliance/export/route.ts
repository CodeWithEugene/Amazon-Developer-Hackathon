import { NextResponse } from "next/server"

import { storeErrorResponse } from "@/lib/api"
import { buildEvidencePackPdf, listClients, toOpenEvvExport } from "@/lib/store"
import { getSessionRole } from "@/lib/session"

/** GET /api/compliance/export?format=pdf|json&clientId=<id> (default: first client) */
export async function GET(request: Request) {
  const role = await getSessionRole()
  if (role !== "compliance" && role !== "scheduler") {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 })
  }
  const url = new URL(request.url)
  const format = url.searchParams.get("format") ?? "json"
  const clientId =
    url.searchParams.get("clientId") ?? (await listClients())[0]?.id
  if (!clientId) {
    return NextResponse.json(
      { error: "No clients in the demo store" },
      { status: 404 }
    )
  }

  try {
    if (format === "pdf") {
      const pdf = await buildEvidencePackPdf(clientId)
      return new NextResponse(pdf as unknown as BodyInit, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="visitproof-evidence-pack.pdf"`,
        },
      })
    }

    const payload = await toOpenEvvExport()
    return new NextResponse(payload, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="visitproof-evv-export.json"`,
      },
    })
  } catch (error) {
    return storeErrorResponse(error)
  }
}
