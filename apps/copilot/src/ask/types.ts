import { z } from "zod"

/** Who is asking: the family (Echo Show at home) or the agency (scheduler). */
export const personaSchema = z.enum(["family", "agency"])
export type Persona = z.infer<typeof personaSchema>

/** Which brain chose the tools: the deterministic rules or the Strands agent on Bedrock. */
export type BrainName = "fixture" | "bedrock"

export interface ToolCallRecord {
  readonly name: string
  readonly arguments: Record<string, unknown>
  readonly isError: boolean
  /** The spoken line the tool returned (the text block). */
  readonly text: string
  readonly structuredContent?: Record<string, unknown>
  readonly durationMs: number
}

export interface TraceStep {
  readonly step: string
  readonly durationMs: number
  readonly detail?: string
}

/** A write the server asked the user to confirm; replayed with confirmed true on "yes". */
export const pendingConfirmationSchema = z.object({
  name: z.enum(["acknowledge_exception", "add_visit_note"]),
  arguments: z.record(z.string(), z.unknown()),
})
export type PendingConfirmation = z.infer<typeof pendingConfirmationSchema>

export interface AskTurn {
  readonly utterance: string
  readonly persona: Persona
  readonly brain: BrainName
  /** Why the brain picked these tools (fixture rules) or the model id (bedrock). */
  readonly reasoning: string
  readonly spoken: string
  readonly toolCalls: readonly ToolCallRecord[]
  readonly trace: readonly TraceStep[]
  readonly pendingConfirmation?: PendingConfirmation
}

/** One call against the VisitProof MCP server. */
export interface ToolCaller {
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallRecord>
}
