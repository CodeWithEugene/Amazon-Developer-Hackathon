import "server-only"

import { NextResponse } from "next/server"

import { StoreError } from "@/lib/store/errors"

/**
 * Maps store-layer failures to honest status codes: typed store errors
 * (not found, validation, conflict, consent) carry a safe message and
 * status; a legacy `Error("<what> not found")` still becomes a 404; anything
 * else becomes a generic 500 so internals never leak. The underlying error
 * is logged server-side.
 */
export function storeErrorResponse(error: unknown): NextResponse {
  if (error instanceof StoreError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  if (error instanceof Error && error.message.endsWith("not found")) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }
  console.error("[api] unhandled store error", error)
  return NextResponse.json(
    { error: "Something went wrong. Try again." },
    { status: 500 }
  )
}

const SAME_SITE_FETCH = new Set(["same-origin", "none"])

/**
 * Cross-site request guard for cookie-authenticated mutations. Browsers send
 * `Sec-Fetch-Site` and `Origin`; a request from another site is refused, and
 * a request with a body must be JSON (text/plain form posts are refused).
 * Returns a response to send, or null when the request may proceed.
 */
export function rejectCrossSite(
  request: Request,
  { requireJson = true }: { requireJson?: boolean } = {}
): NextResponse | null {
  const fetchSite = request.headers.get("sec-fetch-site")
  if (fetchSite && !SAME_SITE_FETCH.has(fetchSite)) {
    return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 })
  }
  const origin = request.headers.get("origin")
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  if (origin && host && safeHost(origin) !== host) {
    return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 })
  }
  const contentType = request.headers.get("content-type") ?? ""
  if (requireJson && !contentType.toLowerCase().startsWith("application/json")) {
    return NextResponse.json(
      { error: "Send the request as application/json" },
      { status: 415 }
    )
  }
  return null
}

function safeHost(origin: string): string | null {
  try {
    return new URL(origin).host
  } catch {
    // An unparseable Origin never matches the host, so the request is refused.
    return null
  }
}
