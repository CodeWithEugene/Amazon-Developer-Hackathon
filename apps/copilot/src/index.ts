import { z } from "zod"

/** Runtime settings for the copilot brain. `fixture` replays golden utterances offline. */
export const copilotConfigSchema = z.object({
  modelProvider: z.enum(["fixture", "bedrock"]).default("fixture"),
  mcpUrl: z.url().default("http://localhost:8000/mcp"),
  modelId: z.string().min(1).default("global.amazon.nova-2-lite-v1:0"),
})

export type CopilotConfig = z.infer<typeof copilotConfigSchema>

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
export { COPILOT_TOOLS, findTool } from "./tools"
export type { CopilotTool, ToolResult } from "./tools"
