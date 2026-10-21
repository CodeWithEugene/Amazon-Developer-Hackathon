import { call, HELP_TEXT, matchRule } from "./fixture-brain"
import type { BrainName, PendingConfirmation, Persona, ToolCallRecord, ToolCaller } from "./types"

export interface AskContext {
  readonly utterance: string
  readonly persona: Persona
  readonly caller: ToolCaller
  readonly now: () => Date
  /** Agency time zone used to resolve "today" and "yesterday" (contract C1). */
  readonly timeZone: string
  /** A write from the previous turn waiting for a yes or no. */
  readonly pending?: PendingConfirmation
}

export interface BrainResult {
  readonly calls: readonly ToolCallRecord[]
  readonly spoken: string
  readonly reasoning: string
  readonly pendingConfirmation?: PendingConfirmation
}

export interface Brain {
  readonly name: BrainName
  answer(context: AskContext): Promise<BrainResult>
}

const YES = /^\s*(yes|yeah|yep|sure|confirm|confirmed|do it|go ahead|ok(ay)?)\b/i
const NO = /^\s*(no|nope|cancel|don'?t|stop|never mind)\b/i

/** A pending write resolves on the next yes (confirmed true) or no (confirmed false). */
const resolvePending = async (context: AskContext, pending: PendingConfirmation): Promise<BrainResult | null> => {
  const yes = YES.test(context.utterance)
  if (!yes && !NO.test(context.utterance)) return null
  const record = await call(context, pending.name, { ...pending.arguments, confirmed: yes })
  return {
    calls: [record],
    spoken: record.text,
    reasoning: yes ? "the user confirmed the pending write; replaying it with confirmed true" : "the user declined the pending write",
  }
}

/** Deterministic brain (MODEL_PROVIDER=fixture): rules choose the MCP tools. */
export const fixtureBrain: Brain = {
  name: "fixture",
  async answer(context) {
    if (context.pending) {
      const resolved = await resolvePending(context, context.pending)
      if (resolved) return resolved
    }
    const rule = matchRule(context)
    if (!rule) return { calls: [], spoken: HELP_TEXT, reasoning: "no fixture rule matched the utterance" }
    const result = await rule.run(context)
    return { ...result, reasoning: `${rule.intent}: ${result.reasoning}` }
  },
}
