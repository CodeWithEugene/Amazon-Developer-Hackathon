import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"

import { RingClient } from "@visitproof/ring-partner-sdk"

import { rejectCrossSite } from "@/lib/api"
import { completeAccountLink } from "@/lib/ring/account-link"
import { getTokenCipher, getTokenStore, ringEnv } from "@/lib/ring/live"
import { SESSION_COOKIE } from "@/lib/session"
import { createSessionToken, SESSION_TTL_SECONDS } from "@/lib/session-token"
import { AGENCY_ID, getSessionClientId, getStore } from "@/lib/store"

/**
 * Account Link form post: demo passwordless sign in (a family session for
 * the demo household), constant-time nonce match, `POST app-integrations`,
 * `PATCH status completed`, then a 303 to the App Homepage.
 */

const formSchema = z.object({
  nonce: z.string().min(1).max(512),
  time: z.string().regex(/^\d{1,16}$/),
  email: z.email().max(320),
})

const redirectTo = (request: Request, path: string) => NextResponse.redirect(new URL(path, request.url), 303)

const signInFamily = async (): Promise<void> => {
  const jar = await cookies()
  jar.set(SESSION_COOKIE, createSessionToken("family"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  })
}

export async function POST(request: Request) {
  const refused = rejectCrossSite(request, { requireJson: false })
  if (refused) return refused
  const parsed = formSchema.safeParse(Object.fromEntries(await request.formData()))
  if (!parsed.success) return redirectTo(request, "/ring?error=invalid")
  const clientId = await getSessionClientId()
  if (!clientId) return redirectTo(request, "/ring?error=misconfigured")
  const env = ringEnv()
  const result = await completeAccountLink(
    { query: { nonce: parsed.data.nonce, time: parsed.data.time }, clientId },
    {
      store: getTokenStore(),
      hmacKey: env.RING_HMAC_SIGNING_KEY ?? "",
      now: Date.now,
      cipher: getTokenCipher(env),
      repository: getStore(),
      agencyId: AGENCY_ID,
      integrationClientFor: (accessToken) =>
        new RingClient({ baseUrl: env.RING_API_BASE, getAccessToken: () => accessToken }),
    }
  )
  if (!result.ok) return redirectTo(request, `/ring?error=${result.reason}`)
  await signInFamily()
  return redirectTo(request, "/ring?linked=1")
}
