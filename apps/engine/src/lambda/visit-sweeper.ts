/**
 * Lambda entry: the every-minute sweep (EventBridge rule, EngineStack). Runs
 * the visit sweeper, then the snapshot fetcher and the narrative writer. A
 * failure in the enrichment steps is logged and rethrown after the others
 * ran, so the invocation is marked failed without skipping the sweep.
 */
import type { ScheduledEvent } from "aws-lambda"

import { createAwsDeps } from "../aws-deps"
import { createNarrativeWriter } from "../handlers/narrative-writer"
import { createSnapshotFetcher } from "../handlers/snapshot-fetcher"
import { createVisitSweeper } from "../handlers/visit-sweeper"
import { consoleLogger } from "../lib/ports"

const { deps } = createAwsDeps(process.env)
const logger = deps.logger ?? consoleLogger
const sweep = createVisitSweeper(deps)
const enrichments = [
  { name: "snapshot-fetcher", run: createSnapshotFetcher(deps) },
  { name: "narrative-writer", run: () => createNarrativeWriter(deps)() },
] as const

export const handler = async (event: ScheduledEvent): Promise<void> => {
  await sweep(event)
  const failures: string[] = []
  for (const step of enrichments) {
    try {
      await step.run()
    } catch (error) {
      failures.push(step.name)
      logger.error(`[visit-sweeper] ${step.name} failed`, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  if (failures.length > 0)
    throw new Error(`enrichment steps failed: ${failures.join(", ")}`)
}
