import { z } from "zod"

import { DEFAULT_TIME_ZONE } from "../time"
import { fixtureBrain, type AskContext, type Brain, type BrainResult } from "./brain"
import { connectMcp } from "./mcp-session"
import type { AskTurn, BrainName, PendingConfirmation, Persona, TraceStep } from "./types"

/** Runtime settings for Ask VisitProof, read from the environment by {@link askConfigFromEnv}. */
export const askConfigSchema = z.object({
  modelProvider: z.enum(["fixture", "bedrock"]).default("fixture"),
  mcpUrl: z.url().default("http://localhost:8000/mcp"),
  modelId: z.string().min(1).default("global.amazon.nova-2-lite-v1:0"),
  region: z.string().min(1).default("us-east-1"),
  timeZone: z.string().min(1).default(DEFAULT_TIME_ZONE),
})
export type AskConfig = z.infer<typeof askConfigSchema>

const blank = (value: string | undefined) => (value && value.trim().length > 0 ? value.trim() : undefined)

export const askConfigFromEnv = (env: Readonly<Record<string, string | undefined>>): AskConfig =>
  askConfigSchema.parse({
    modelProvider: blank(env.MODEL_PROVIDER),
    mcpUrl: blank(env.MCP_URL),
    modelId: blank(env.BEDROCK_MODEL_ID),
    region: blank(env.AWS_REGION),
    timeZone: blank(env.VISITPROOF_TIME_ZONE),
  })

export interface AskRequest {
  readonly utterance: string
  readonly persona: Persona
  readonly token?: string
  readonly pending?: PendingConfirmation
}

export interface AskOptions {
  readonly config: AskConfig
  readonly now?: () => Date
  /** Builds the model-backed brain; the Strands module is loaded lazily so fixture mode never imports it. */
  readonly bedrockBrain?: (config: AskConfig, token?: string) => Promise<Brain>
}

const elapsed = (start: number) => Math.round(performance.now() - start)

const loadBedrockBrain = async (config: AskConfig, token?: string): Promise<Brain> => {
  const { createStrandsBrain } = await import("./strands-brain")
  return createStrandsBrain({ mcpUrl: config.mcpUrl, modelId: config.modelId, region: config.region, ...(token ? { token } : {}) })
}

const runFixture = async (request: AskRequest, options: AskOptions, context: Omit<AskContext, "caller">) => {
  const session = await connectMcp({ url: options.config.mcpUrl, ...(request.token ? { token: request.token } : {}) })
  try {
    const result = await fixtureBrain.answer({ ...context, caller: session })
    return { result, trace: [...session.trace] }
  } finally {
    await session.close()
  }
}

const toTurn = (request: AskRequest, brain: BrainName, result: BrainResult, trace: TraceStep[], note?: string): AskTurn => ({
  utterance: request.utterance,
  persona: request.persona,
  brain,
  reasoning: note ? `${result.reasoning} (${note})` : result.reasoning,
  spoken: result.spoken,
  toolCalls: result.calls,
  trace: [...trace, ...result.calls.map((call) => ({ step: `tools/call ${call.name}`, durationMs: call.durationMs, ...(call.isError ? { detail: "isError" } : {}) }))],
  ...(result.pendingConfirmation ? { pendingConfirmation: result.pendingConfirmation } : {}),
})

/**
 * One Ask VisitProof turn: the configured brain chooses VisitProof MCP tools
 * and calls them over Streamable HTTP. With MODEL_PROVIDER=bedrock the
 * Strands agent answers; if Bedrock fails, the fixture brain answers and the
 * turn says so.
 */
export async function askVisitProof(request: AskRequest, options: AskOptions): Promise<AskTurn> {
  const context: Omit<AskContext, "caller"> = {
    utterance: request.utterance,
    persona: request.persona,
    now: options.now ?? (() => new Date()),
    timeZone: options.config.timeZone,
    ...(request.pending ? { pending: request.pending } : {}),
  }
  const started = performance.now()
  if (options.config.modelProvider === "bedrock") {
    try {
      const brain = await (options.bedrockBrain ?? loadBedrockBrain)(options.config, request.token)
      const result = await brain.answer({ ...context, caller: { callTool: () => Promise.reject(new Error("the Strands brain uses its own MCP client")) } })
      return toTurn(request, "bedrock", result, [{ step: "strands agent", durationMs: elapsed(started), detail: options.config.modelId }])
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const { result, trace } = await runFixture(request, options, context)
      return toTurn(request, "fixture", result, [{ step: "bedrock failed", durationMs: elapsed(started), detail: reason }, ...trace], `Bedrock unavailable: ${reason}`)
    }
  }
  const { result, trace } = await runFixture(request, options, context)
  return toTurn(request, "fixture", result, trace)
}
