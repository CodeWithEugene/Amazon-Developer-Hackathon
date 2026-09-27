import "server-only"

import { NextResponse } from "next/server"

/**
 * Maps store-layer failures to honest status codes: the store signals a
 * missing record with `Error("<what> not found")`, which becomes a 404 with
 * that safe message; anything else becomes a generic 500 so internals never
 * leak to the client. The underlying error is logged server-side.
 */
export function storeErrorResponse(error: unknown): NextResponse {
  if (error instanceof Error && error.message.endsWith("not found")) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }
  console.error("[api] unhandled store error", error)
  return NextResponse.json(
    { error: "Something went wrong. Try again." },
    { status: 500 }
  )
}
