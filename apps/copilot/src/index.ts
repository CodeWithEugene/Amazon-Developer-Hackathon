import { askConfigSchema } from "./ask/ask"

/**
 * Runtime settings for the copilot brain: `fixture` uses the deterministic
 * rules offline; `bedrock` runs the Strands agent on Nova 2 Lite.
 * Kept for compatibility; {@link askConfigSchema} is the full schema.
 */
export const copilotConfigSchema = askConfigSchema.pick({ modelProvider: true, mcpUrl: true, modelId: true })

export type CopilotConfig = ReturnType<typeof copilotConfigSchema.parse>

export type {
  CopilotDataAccessor,
  ExceptionFilter,
  VisitFilter,
} from "./accessor"
export { createOpsCopilot } from "./agent"
export type {
  CopilotAnswer,
  CreateOpsCopilotOptions,
  OpsCopilot,
} from "./agent"
export { createDbCopilotAccessor } from "./db-accessor"
export { parseIntent, resolveRange } from "./intents"
export type { DateRange, Now, ParsedIntent } from "./intents"
export { COPILOT_TOOLS, DEFAULT_TOOL_ENV, findTool, isLateArrival, MAX_SPOKEN_ITEMS } from "./tools"
export type { CopilotTool, ToolEnv, ToolResult } from "./tools"
export * from "./ask/index"
