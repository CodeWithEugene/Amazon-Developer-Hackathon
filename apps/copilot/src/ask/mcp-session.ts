import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

import type { ToolCallRecord, ToolCaller, TraceStep } from "./types"

export interface McpSessionOptions {
  /** Streamable HTTP endpoint, for example http://localhost:8000/mcp (MCP_URL). */
  readonly url: string
  /** Bearer token for the persona (a demo token in demo mode). */
  readonly token?: string
  readonly clientName?: string
}

export interface McpSession extends ToolCaller {
  readonly serverName: string
  readonly protocolVersion?: string
  readonly toolNames: readonly string[]
  /** Connection steps (initialize, tools/list) with timings. */
  readonly trace: readonly TraceStep[]
  close(): Promise<void>
}

const timed = async <T>(work: () => Promise<T>): Promise<{ value: T; durationMs: number }> => {
  const start = performance.now()
  const value = await work()
  return { value, durationMs: Math.round(performance.now() - start) }
}

const textOf = (content: unknown): string =>
  Array.isArray(content)
    ? content
        .filter((item): item is { type: "text"; text: string } => typeof item === "object" && item !== null && (item as { type?: unknown }).type === "text")
        .map((item) => item.text)
        .join(" ")
    : ""

/**
 * Opens a real MCP session with `@modelcontextprotocol/sdk` over Streamable
 * HTTP: this is the runtime proof that the Ask VisitProof experience talks
 * to the MCP server the way Alexa+ does.
 */
export async function connectMcp(options: McpSessionOptions): Promise<McpSession> {
  const client = new Client({ name: options.clientName ?? "ask-visitproof", version: "0.2.0" }, { capabilities: {} })
  const transport = new StreamableHTTPClientTransport(new URL(options.url), {
    requestInit: options.token ? { headers: { authorization: `Bearer ${options.token}` } } : {},
  })
  const connected = await timed(() => client.connect(transport))
  const listed = await timed(() => client.listTools())
  const server = client.getServerVersion()
  const trace: TraceStep[] = [
    { step: "initialize", durationMs: connected.durationMs, detail: `${server?.name ?? "unknown"} ${server?.version ?? ""}`.trim() },
    { step: "tools/list", durationMs: listed.durationMs, detail: `${listed.value.tools.length} tools` },
  ]
  return {
    serverName: server?.name ?? "unknown",
    protocolVersion: transport.protocolVersion,
    toolNames: listed.value.tools.map((tool) => tool.name),
    trace,
    async callTool(name, args): Promise<ToolCallRecord> {
      const { value, durationMs } = await timed(() => client.callTool({ name, arguments: args }))
      return {
        name,
        arguments: args,
        isError: value.isError === true,
        text: textOf(value.content),
        ...(value.structuredContent ? { structuredContent: value.structuredContent as Record<string, unknown> } : {}),
        durationMs,
      }
    },
    close: () => client.close(),
  }
}
