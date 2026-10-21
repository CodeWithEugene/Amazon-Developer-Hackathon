import { z } from "zod"

/** Browser-side validation of /api/ask responses (Zod at the boundary). */
export const toolCallSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  isError: z.boolean(),
  text: z.string(),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
  durationMs: z.number(),
})
export type ToolCall = z.infer<typeof toolCallSchema>

export const pendingSchema = z.object({
  name: z.enum(["acknowledge_exception", "add_visit_note"]),
  arguments: z.record(z.string(), z.unknown()),
})
export type Pending = z.infer<typeof pendingSchema>

export const turnSchema = z.object({
  utterance: z.string(),
  persona: z.enum(["family", "agency"]),
  brain: z.enum(["fixture", "bedrock"]),
  reasoning: z.string(),
  spoken: z.string(),
  toolCalls: z.array(toolCallSchema),
  trace: z.array(z.object({ step: z.string(), durationMs: z.number(), detail: z.string().optional() })),
  pendingConfirmation: pendingSchema.optional(),
})
export type Turn = z.infer<typeof turnSchema>

export const askResponseSchema = z.object({ turn: turnSchema, provenance: z.string(), mcpUrl: z.string() })
export const askErrorSchema = z.object({ error: z.string() })

export type DeviceSize = "small" | "large"

export const BRAIN_LABELS: Record<Turn["brain"], string> = {
  fixture: "Fixture Brain",
  bedrock: "Strands Agent on Bedrock",
}

export const TOOL_TITLES: Record<string, string> = {
  get_visit_status: "Visit Status",
  list_visits: "Visits",
  list_exceptions: "Exceptions",
  explain_visit: "Visit Evidence",
  get_client_summary: "Client Summary",
  acknowledge_exception: "Acknowledge Exception",
  add_visit_note: "Visit Note",
}

export const SUGGESTIONS: Record<Turn["persona"], readonly string[]> = {
  family: ["Did the caregiver come today?", "Was anyone late this week?", "Tell the agency I'll be there Thursday instead"],
  agency: ["What are today's exceptions?", "Who was late this week?", "Give me the morning briefing"],
}
