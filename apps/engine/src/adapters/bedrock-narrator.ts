/**
 * Narratives from Amazon Bedrock (Converse API, Nova 2 Lite by default) with
 * optional Bedrock Guardrails. The model only rephrases facts the
 * deterministic template already stated; it never decides anything.
 *
 * Every model answer is checked with the domain narrative validator (times
 * present, under 60 words, no names other than the caregiver's). Anything
 * that fails, a guardrail intervention, or any Bedrock error falls back to
 * the template narrative with provenance "template".
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime"
import {
  buildNarrative,
  narrativeTime,
  validateNarrative,
  type Narrative,
  type NarrativeOptions,
  type Visit,
} from "@visitproof/domain"

import {
  consoleLogger,
  type Logger,
  type Narrator,
  type NarratorInput,
} from "../lib/ports"

export const DEFAULT_BEDROCK_MODEL_ID = "global.amazon.nova-2-lite-v1:0"

const MAX_OUTPUT_TOKENS = 160
const TEMPERATURE = 0.2

const SYSTEM_PROMPT = [
  "You rewrite home care visit summaries for a family member.",
  "Rewrite the DRAFT in plain, warm, factual language.",
  "Keep every clock time and its time zone exactly as written in the DRAFT.",
  "Use fewer than 60 words. Do not add facts, names, health details, or guesses.",
  "Do not use dashes. Reply with the summary text only.",
].join(" ")

export interface BedrockNarratorOptions {
  client: Pick<BedrockRuntimeClient, "send">
  modelId?: string
  guardrail?: { id: string; version: string }
  logger?: Logger
}

/**
 * Facts only: statuses and times, never names or free text. Times are
 * rendered exactly as the DRAFT renders them (agency-local with the zone,
 * "8:04 AM ET"), so the model never sees a raw UTC instant to copy.
 */
function factsFor(
  visit: Visit,
  options: NarrativeOptions
): Record<string, unknown> {
  const time = (iso: string | undefined) =>
    iso === undefined ? undefined : narrativeTime(iso, options)
  return {
    status: visit.status,
    scheduledStart: time(visit.scheduledStart),
    scheduledEnd: time(visit.scheduledEnd),
    arrivalAt: time(visit.arrival?.at),
    departureAt: time(visit.departure?.at),
    observability: visit.observability.state,
    reconciliation: visit.reconciliation?.outcome,
  }
}

function requestFor(
  options: BedrockNarratorOptions,
  input: NarratorInput,
  draft: Narrative
): ConverseCommandInput {
  const facts = factsFor(input.visit, { timeZone: input.timeZone })
  const prompt = `DRAFT: ${draft.text}\nFACTS: ${JSON.stringify(facts)}`
  return {
    modelId: options.modelId ?? DEFAULT_BEDROCK_MODEL_ID,
    system: [{ text: SYSTEM_PROMPT }],
    messages: [{ role: "user", content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens: MAX_OUTPUT_TOKENS, temperature: TEMPERATURE },
    ...(options.guardrail
      ? {
          guardrailConfig: {
            guardrailIdentifier: options.guardrail.id,
            guardrailVersion: options.guardrail.version,
          },
        }
      : {}),
  }
}

function textOf(output: ConverseCommandOutput): string {
  const blocks = output.output?.message?.content ?? []
  return blocks
    .map((block) =>
      "text" in block && typeof block.text === "string" ? block.text : ""
    )
    .join(" ")
    .trim()
}

/** Why a model answer cannot be used, or null when it passes every rule. */
function rejectionReason(
  output: ConverseCommandOutput,
  input: NarratorInput
): string | null {
  if (output.stopReason === "guardrail_intervened")
    return "guardrail intervened"
  const text = textOf(output)
  if (text.length === 0) return "empty model output"
  const rules = validateNarrative(text, input.visit, input.caregiverName, {
    timeZone: input.timeZone,
  })
  const failed = Object.entries(rules)
    .filter(([, passed]) => !passed)
    .map(([rule]) => rule)
  return failed.length > 0
    ? `failed narrative rules: ${failed.join(", ")}`
    : null
}

export function createBedrockNarrator(
  options: BedrockNarratorOptions
): Narrator {
  const logger = options.logger ?? consoleLogger
  return {
    name: "bedrock",
    async write(input) {
      const draft = buildNarrative(input)
      let output: ConverseCommandOutput
      try {
        output = await options.client.send(
          new ConverseCommand(requestFor(options, input, draft))
        )
      } catch (error) {
        logger.warn("[bedrock-narrator] Converse failed; using the template", {
          visitId: input.visit.id,
          error: error instanceof Error ? error.name : String(error),
        })
        return draft
      }
      const reason = rejectionReason(output, input)
      if (reason !== null) {
        logger.warn(
          "[bedrock-narrator] model narrative rejected; using the template",
          {
            visitId: input.visit.id,
            reason,
          }
        )
        return draft
      }
      return {
        text: textOf(output),
        provenance: "bedrock",
        generatedAt: input.now.toISOString(),
      }
    },
  }
}
