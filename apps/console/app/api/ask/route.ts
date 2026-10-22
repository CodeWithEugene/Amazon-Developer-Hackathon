import { NextResponse } from "next/server"
import { z } from "zod"

import {
  askConfigFromEnv,
  askVisitProof,
  demoTokenFor,
  pendingConfirmationSchema,
  type Persona,
} from "@visitproof/copilot"

import { ASK_PROVENANCE } from "@/components/ask/provenance"
import { rejectCrossSite } from "@/lib/api"
import type { Role } from "@/lib/roles"
import { getSessionRole } from "@/lib/session"
import { ASK_HOSTED_UNAVAILABLE, isHostedDemo } from "@/lib/store/hosted"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const requestSchema = z.object({
  utterance: z.string().trim().min(1).max(500),
  pending: pendingConfirmationSchema.optional(),
})

/** The persona is bound to the signed-in role, never chosen by the browser. */
const personaFor = (role: Role | null): Persona | null => {
  if (role === "family") return "family"
  if (role === "scheduler" || role === "compliance") return "agency"
  return null
}

const errorJson = (status: number, error: string) => NextResponse.json({ error }, { status })

/**
 * In demo mode the route presents the persona's demo bearer token to the MCP
 * server (MCP_DEMO_TOKENS). Live mode needs a real OAuth access token, which
 * this simulator does not hold yet.
 */
const tokenFor = (persona: Persona): string | undefined =>
  (process.env.VISITPROOF_MODE ?? "demo") === "demo" ? demoTokenFor(persona, process.env.MCP_DEMO_TOKENS)?.token : undefined

const isConnectionFailure = (error: unknown): boolean => {
  const text = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error)
  return /ECONNREFUSED|fetch failed|ENOTFOUND|ETIMEDOUT|socket|connect/i.test(text)
}

/** Brain and MCP endpoint for the page header (no data, no tool calls). */
export async function GET(): Promise<NextResponse> {
  const config = askConfigFromEnv(process.env)
  return NextResponse.json({ brain: config.modelProvider, modelId: config.modelId, mcpUrl: config.mcpUrl, provenance: ASK_PROVENANCE })
}

/** One Ask VisitProof turn: the copilot brain picks tools and calls the MCP server over Streamable HTTP. */
export async function POST(request: Request): Promise<NextResponse> {
  const rejected = rejectCrossSite(request)
  if (rejected) return rejected
  const persona = personaFor(await getSessionRole())
  if (!persona) return errorJson(401, "Sign in as a family member or agency staff to use Ask VisitProof.")
  if (isHostedDemo()) return errorJson(503, ASK_HOSTED_UNAVAILABLE)
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorJson(400, "Say or type a question of up to 500 characters.")
  const config = askConfigFromEnv(process.env)
  const token = tokenFor(persona)
  if (!token) return errorJson(501, "Ask VisitProof needs a demo token for this persona. Set MCP_DEMO_TOKENS in demo mode.")
  try {
    const turn = await askVisitProof(
      { utterance: parsed.data.utterance, persona, token, ...(parsed.data.pending ? { pending: parsed.data.pending } : {}) },
      { config },
    )
    return NextResponse.json({ turn, provenance: ASK_PROVENANCE, mcpUrl: config.mcpUrl })
  } catch (error) {
    if (isConnectionFailure(error)) {
      return errorJson(502, `Could not reach the VisitProof MCP server at ${config.mcpUrl}. Start it with pnpm --filter @visitproof/mcp dev.`)
    }
    console.error("[ask] turn failed", error)
    return errorJson(500, "Ask VisitProof could not answer. Try again.")
  }
}
