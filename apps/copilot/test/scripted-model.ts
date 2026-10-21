import { Model, type BaseModelConfig, type Message, type ModelStreamEvent } from "@strands-agents/sdk"

/**
 * A scripted stand-in for BedrockModel: the first turn asks for the planned
 * tool calls, the next turn answers with the text of the last tool result.
 * Lets the Strands agent loop and its MCP client run for real with no AWS.
 */
export interface PlannedCall {
  readonly name: string
  readonly input: Record<string, unknown>
}

const lastToolResultText = (messages: readonly Message[]): string => {
  for (const message of [...messages].reverse()) {
    for (const block of message.content) {
      if (block.type === "toolResultBlock") {
        return block.content.map((item) => ("text" in item && typeof item.text === "string" ? item.text : "")).join(" ")
      }
    }
  }
  return ""
}

export class ScriptedModel extends Model<BaseModelConfig> {
  private config: BaseModelConfig = { modelId: "scripted-nova-2-lite" }
  readonly seenSystemPrompts: string[] = []

  constructor(private readonly plan: readonly PlannedCall[]) {
    super()
  }

  updateConfig(config: BaseModelConfig): void {
    this.config = { ...this.config, ...config }
  }

  getConfig(): BaseModelConfig {
    return this.config
  }

  async *stream(messages: Message[], options?: { systemPrompt?: unknown }): AsyncGenerator<ModelStreamEvent> {
    if (typeof options?.systemPrompt === "string") this.seenSystemPrompts.push(options.systemPrompt)
    const toolTurns = messages.filter((message) => message.content.some((block) => block.type === "toolResultBlock")).length
    yield { type: "modelMessageStartEvent", role: "assistant" }
    const next = this.plan[toolTurns]
    if (next) {
      yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: next.name, toolUseId: `tool-${toolTurns}` } }
      yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(next.input) } }
      yield { type: "modelContentBlockStopEvent" }
      yield { type: "modelMessageStopEvent", stopReason: "toolUse" }
      return
    }
    yield { type: "modelContentBlockStartEvent" }
    yield { type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: lastToolResultText(messages) } }
    yield { type: "modelContentBlockStopEvent" }
    yield { type: "modelMessageStopEvent", stopReason: "endTurn" }
  }
}
