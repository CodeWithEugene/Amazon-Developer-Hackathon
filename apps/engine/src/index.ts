/**
 * @visitproof/engine: Lambda handlers plus the pure engine as a library.
 * The demo studio and local webhooks import the pure functions directly;
 * production deploys the handler factories with DynamoDB/SES/S3-backed deps.
 */
export { ENGINE_HANDLERS, type EngineHandlerName } from "./handlers-registry"

// Pure engine (re-exported so callers can use this package as a library)
export {
  processEvent,
  sweepVisits,
  type ProcessEventInput,
  type ProcessEventResult,
  type SweepVisitsInput,
  type SweepVisitsResult,
} from "@visitproof/domain"
export { buildNarrative } from "@visitproof/domain"
export { buildEvidencePack, toOpenEvvVisit, signLedger, verifyChain } from "@visitproof/domain"

// Ports and in-memory defaults for demo and tests
export * from "./lib/ports"
export * from "./lib/defaults"

// Handler factories
export { createEventProcessor, ingestDoorEvent } from "./handlers/event-processor"
export { createVisitSweeper } from "./handlers/visit-sweeper"
export { createNarrativeWriter } from "./handlers/narrative-writer"
export { createSnapshotFetcher } from "./handlers/snapshot-fetcher"
export { createExporter } from "./handlers/exporter"
export { createMailer } from "./handlers/mailer"
