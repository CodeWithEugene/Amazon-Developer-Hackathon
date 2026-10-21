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
export {
  buildEvidencePack,
  toOpenEvvVisit,
  signLedger,
  verifyChain,
} from "@visitproof/domain"

// Ports and in-memory defaults for demo and tests
export * from "./lib/ports"
export * from "./lib/defaults"

// Handler factories
export {
  createEventProcessor,
  ingestDoorEvent,
} from "./handlers/event-processor"
export { createVisitSweeper } from "./handlers/visit-sweeper"
export { createNarrativeWriter } from "./handlers/narrative-writer"
export { createSnapshotFetcher } from "./handlers/snapshot-fetcher"
export { createExporter } from "./handlers/exporter"
export { createMailer } from "./handlers/mailer"
export { type IngestOptions } from "./handlers/event-processor"
export { type MailerInput } from "./handlers/mailer"

// Agency-aware helpers and repository wiring
export { tolerancesFor, timeZoneFor, DEFAULT_TIME_ZONE } from "./lib/agency"
export {
  repositoryEngineDeps,
  repositorySnapshotRecords,
} from "./lib/repository-deps"
export { repositoryLedger } from "./lib/ledger"
export {
  eventsAsOf,
  replayInSimulatedTime,
  simulatedClock,
  REPLAY_EVENT_LAG_MS,
  type ReplayHooks,
  type ReplaySummary,
  type ReplayWindow,
  type SimulatedClock,
} from "./replay"
export { applyExceptions, applyVisit, ledgerDoorEvent } from "./lib/apply"

// AWS runtime adapters (each behind an env switch; see createAwsDeps)
export {
  createAwsDeps,
  awsDepsEnvSchema,
  type AdapterMatrix,
  type AwsClients,
  type AwsDeps,
  type AwsDepsEnv,
} from "./aws-deps"
export {
  createBedrockNarrator,
  DEFAULT_BEDROCK_MODEL_ID,
} from "./adapters/bedrock-narrator"
export {
  createKmsLedgerSigner,
  createLocalHmacLedgerSigner,
  signLedgerWith,
  KMS_SIGNING_ALGORITHM,
  type AsyncLedgerSigner,
  type UnsignedLedgerInput,
} from "./adapters/ledger-signers"
export {
  createSesMailTransport,
  type SesMailerOptions,
} from "./adapters/ses-mailer"
export {
  RingS3SnapshotService,
  type RingS3SnapshotOptions,
  type SnapshotOutcome,
  type SnapshotSource,
} from "./adapters/ring-snapshot-service"
export { createS3EvidenceStore } from "./adapters/s3-evidence-store"
