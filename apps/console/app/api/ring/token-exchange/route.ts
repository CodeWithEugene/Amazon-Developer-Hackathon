import { NextResponse } from "next/server"

import { exchangeAuthorizationCode, RingClient } from "@visitproof/ring-partner-sdk"

import { getTokenCipher, getTokenStore, ringEnv } from "@/lib/ring/live"
import { handleTokenExchange } from "@/lib/ring/token-exchange"

/**
 * Ring Token Exchange URL (docs/build.md 5.2). Ring POSTs the authorization
 * code (JSON or form encoded); the code is exchanged within 60 seconds,
 * `users/me` is called, and the tokens are stored encrypted as UNCLAIMED.
 */

const readBody = async (request: Request): Promise<unknown> => {
  const type = request.headers.get("content-type") ?? ""
  if (type.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(await request.text()))
  }
  return request.json().catch(() => null)
}

export async function POST(request: Request) {
  const env = ringEnv()
  if (!env.RING_CLIENT_ID || !env.RING_CLIENT_SECRET) {
    return NextResponse.json(
      { error: "Ring app credentials are not configured on this server.", code: "misconfigured" },
      { status: 503 }
    )
  }
  const result = await handleTokenExchange(await readBody(request), {
    exchange: (code, signal) =>
      exchangeAuthorizationCode({
        clientId: env.RING_CLIENT_ID ?? "",
        clientSecret: env.RING_CLIENT_SECRET ?? "",
        tokenUrl: env.RING_OAUTH_TOKEN_URL,
        code,
        signal,
      }),
    me: (accessToken) => new RingClient({ baseUrl: env.RING_API_BASE, getAccessToken: () => accessToken }).me(),
    cipher: getTokenCipher(env),
    store: getTokenStore(),
    now: Date.now,
  })
  return NextResponse.json(result.body, { status: result.status })
}
