import { NextResponse } from "next/server"

import { rejectCrossSite, storeErrorResponse } from "@/lib/api"
import { deleteClientData, exportClientData, getSessionClientId } from "@/lib/store"
import { getSessionRole } from "@/lib/session"

/** GET exports the family's data as JSON. DELETE removes all client data. */
export async function GET() {
  const role = await getSessionRole()
  if (role !== "family") {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 })
  }
  const clientId = await getSessionClientId()
  if (!clientId) {
    return NextResponse.json({ error: "No clients in the demo store" }, { status: 404 })
  }
  try {
    const payload = await exportClientData(clientId)
    return new NextResponse(payload, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="visitproof-my-data.json"`,
      },
    })
  } catch (error) {
    return storeErrorResponse(error)
  }
}

export async function DELETE(request: Request) {
  const role = await getSessionRole()
  if (role !== "family") {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 })
  }
  const refused = rejectCrossSite(request, { requireJson: false })
  if (refused) return refused
  const clientId = await getSessionClientId()
  if (!clientId) {
    return NextResponse.json({ error: "No clients in the demo store" }, { status: 404 })
  }
  try {
    const deleted = await deleteClientData(clientId)
    return NextResponse.json({ ok: true, deleted })
  } catch (error) {
    return storeErrorResponse(error)
  }
}
