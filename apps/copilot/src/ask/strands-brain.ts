import { Agent, BedrockModel, McpClient, type Model } from "@strands-agents/sdk"

import { localDateKey } from "../time"
import type { AskContext, Brain, BrainResult } from "./brain"
import type { PendingConfirmation, ToolCallRecord } from "./types"

/**
 * The model-backed brain (MODEL_PROVIDER=bedrock): a Strands agent whose only
 * tool source is the VisitProof MCP server, reached through Strands'
 * `McpClient` over Streamable HTTP, reasoning with Amazon Bedrock
 * (Nova 2 Lite by default, BEDROCK_MODEL_ID). Tests inject a scripted model,
 * so no AWS call is ever made in CI.
 */
export interface StrandsBrainOptions {
  readonly mcpUrl: string
  readonly token?: string
  /** Bedrock model id, for example global.amazon.nova-2-lite-v1:0. */
  readonly modelId: string
  readonly region?: string
  /** Injected model (tests); defaults to BedrockModel with modelId and region. */
  readonly model?: Model
}

type RawToolResult = { content?: unknown; structuredContent?: Record<string, unknown>; isError?: boolean }

const textOf = (content: unknown): string =>
  Array.isArray(content)
    ? content
        .filter((item): item is { type: "text"; text: string } => typeof item === "object" && item !== null && (item as { type?: unknown }).type === "text")
        .map((item) => item.text)
        .join(" ")
    : ""

/** Strands' McpClient that also records each raw call (structured content and timing) for the trace. */
class RecordingMcpClient extends McpClient {
  readonly calls: ToolCallRecord[] = []

  override async callTool(...params: Parameters<McpClient["callTool"]>): ReturnType<McpClient["callTool"]> {
    const [tool, args] = params
    const start = performance.now()
    const raw = (await super.callTool(...params)) as RawToolResult
    this.calls.push({
      name: tool.name,
      arguments: (args ?? {}) as Record<string, unknown>,
      isError: raw.isError === true,
      text: textOf(raw.content),
      ...(raw.structuredContent ? { structuredContent: raw.structuredContent } : {}),
      durationMs: Math.round(performance.now() - start),
    })
    return raw as Awaited<ReturnType<McpClient["callTool"]>>
  }
}

const pendingLine = (pending?: PendingConfirmation): string =>
  pending
    ? `A write is waiting for confirmation: ${pending.name} ${JSON.stringify(pending.arguments)}. If the user says yes, call it again with confirmed true; if no, call it with confirmed false.`
    : ""

export const systemPromptFor = (context: AskContext): string =>
  [
    "You are Ask VisitProof, a voice assistant for home care visits, speaking on an Echo Show.",
    `The caller is ${context.persona === "family" ? "a family member; their token is bound to one client, so omit clientId" : "agency staff"}.`,
    `Today is ${localDateKey(context.now(), context.timeZone)} in ${context.timeZone}.`,
    "Always answer by calling the VisitProof tools, then reply with the spoken field of the result, under 40 words and at most five items.",
    "The door only sees that someone arrived; never say who. Name a caregiver only when the tool says they clocked in. Never speculate.",
    "For acknowledge_exception or add_visit_note, first call without confirmed and relay the confirmation question.",
    pendingLine(context.pending),
  ]
    .filter((line) => line.length > 0)
    .join("\n")

const pendingFrom = (calls: readonly ToolCallRecord[]): PendingConfirmation | undefined => {
  const last = calls.at(-1)
  if (!last || last.structuredContent?.status !== "confirmation_required") return undefined
  if (last.name !== "acknowledge_exception" && last.name !== "add_visit_note") return undefined
  return { name: last.name, arguments: last.arguments }
}

export function createStrandsBrain(options: StrandsBrainOptions): Brain {
  return {
    name: "bedrock",
    async answer(context): Promise<BrainResult> {
      const client = new RecordingMcpClient({
        url: options.mcpUrl,
        ...(options.token ? { headers: { authorization: `Bearer ${options.token}` } } : {}),
        applicationName: "ask-visitproof-strands",
      })
      const model = options.model ?? new BedrockModel({ modelId: options.modelId, ...(options.region ? { region: options.region } : {}), temperature: 0, maxTokens: 400 })
      const agent = new Agent({ model, tools: [client], systemPrompt: systemPromptFor(context), printer: false })
      try {
        const result = await agent.invoke(context.utterance)
        const pending = pendingFrom(client.calls)
        return {
          calls: client.calls,
          spoken: result.toString().trim() || (client.calls.at(-1)?.text ?? ""),
          reasoning: `Strands agent on ${model.modelId ?? options.modelId} chose ${client.calls.map((call) => call.name).join(", ") || "no tools"}`,
          ...(pending ? { pendingConfirmation: pending } : {}),
        }
      } finally {
        await client.disconnect()
      }
    },
  }
}
