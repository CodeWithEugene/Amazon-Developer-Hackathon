import type { CopilotDataAccessor } from "./accessor"
import { parseIntent, type Now, type ParsedIntent } from "./intents"
import { findTool, type ToolResult } from "./tools"

/**
 * The ops copilot agent: a Strands-style loop with a deterministic brain.
 * `ask(question)` parses the intent, selects one tool, runs it against the
 * injected accessor, and returns the answer plus the query it ran. Every
 * decision is rule-based and narrated; no model runs locally.
 */
export interface CopilotAnswer {
  readonly question: string
  readonly intent: string
  readonly tool: string | null
  readonly answer: string
  readonly query: string | null
  readonly reasoning: string
  readonly data: readonly unknown[]
}

export interface OpsCopilot {
  ask(question: string): Promise<CopilotAnswer>
}

export interface CreateOpsCopilotOptions {
  readonly accessor: CopilotDataAccessor
  /** Injected clock for deterministic tests and replay. Defaults to `Date.now`. */
  readonly now?: Now
}

function unknownAnswer(question: string, parsed: ParsedIntent): CopilotAnswer {
  return {
    question,
    intent: parsed.intent,
    tool: null,
    answer:
      "I can answer questions about late arrivals, no-shows, visits missing evidence, and I can explain an exception. Try: who was late today?",
    query: null,
    reasoning: parsed.reasoning,
    data: [],
  }
}

export function createOpsCopilot(options: CreateOpsCopilotOptions): OpsCopilot {
  const { accessor } = options
  const now: Now = options.now ?? (() => new Date())
  return {
    async ask(question) {
      const parsed = parseIntent(question, now)
      if (parsed.intent === "unknown") {
        return unknownAnswer(question, parsed)
      }
      const tool = findTool(parsed.toolName)
      if (tool === undefined) {
        return unknownAnswer(question, parsed)
      }
      const parsedInput = tool.inputSchema.safeParse(parsed.args)
      if (!parsedInput.success) {
        return {
          question,
          intent: parsed.intent,
          tool: tool.name,
          answer: "I understood the question but the extracted arguments were invalid.",
          query: null,
          reasoning: parsed.reasoning,
          data: [],
        }
      }
      let result: ToolResult
      try {
        result = await tool.call(accessor, parsedInput.data)
      } catch (error) {
        return {
          question,
          intent: parsed.intent,
          tool: tool.name,
          answer: `The data lookup failed: ${error instanceof Error ? error.message : String(error)}`,
          query: null,
          reasoning: parsed.reasoning,
          data: [],
        }
      }
      return {
        question,
        intent: parsed.intent,
        tool: tool.name,
        answer: result.spoken,
        query: result.query,
        reasoning: parsed.reasoning,
        data: result.data,
      }
    },
  }
}
