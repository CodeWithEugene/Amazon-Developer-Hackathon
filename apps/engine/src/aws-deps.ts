/**
 * `createAwsDeps(env)`: the one place that decides which runtime adapters are
 * live. Every AWS adapter sits behind an env switch; with no AWS variables set
 * the engine runs fully offline (local store, template narratives, local HMAC
 * signer, console mail, no snapshots).
 *
 * | Adapter    | Active when                                        | Otherwise                         |
 * |------------|----------------------------------------------------|-----------------------------------|
 * | store      | VISITPROOF_STORE=dynamodb (DYNAMODB_TABLE)         | local JSON store (demo path)      |
 * | narrator   | MODEL_PROVIDER=bedrock (BEDROCK_MODEL_ID, guardrail)| deterministic template            |
 * | signer     | KMS_SIGNING_KEY_ID set                             | local HMAC stand-in (demo only)   |
 * | mail       | SES_FROM_ADDRESS set                               | console fixture (logs only)       |
 * | snapshots  | S3_SNAPSHOT_BUCKET and RING_PLAYGROUND_ACCESS_TOKEN | disabled (no request made)        |
 * | evidence   | S3_SNAPSHOT_BUCKET set                             | in-memory                         |
 *
 * Live mode (VISITPROOF_MODE=live) refuses the local HMAC signer: it is not a
 * public-key signature and must never sign production ledger records.
 */
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime"
import { KMSClient } from "@aws-sdk/client-kms"
import { S3Client } from "@aws-sdk/client-s3"
import { SESClient } from "@aws-sdk/client-ses"
import {
  createDynamoRepository,
  createLocalRepository,
  type VisitProofRepository,
} from "@visitproof/db"
import { RingClient } from "@visitproof/ring-partner-sdk"
import { z } from "zod"

import {
  createBedrockNarrator,
  DEFAULT_BEDROCK_MODEL_ID,
} from "./adapters/bedrock-narrator"
import {
  createKmsLedgerSigner,
  createLocalHmacLedgerSigner,
  type AsyncLedgerSigner,
} from "./adapters/ledger-signers"
import { RingS3SnapshotService } from "./adapters/ring-snapshot-service"
import { createS3EvidenceStore } from "./adapters/s3-evidence-store"
import { createSesMailTransport } from "./adapters/ses-mailer"
import {
  consoleMailTransport,
  InMemoryEvidenceStore,
  NoopSnapshotService,
  templateNarrator,
} from "./lib/defaults"
import { repositoryLedger } from "./lib/ledger"
import { consoleLogger, type EngineDeps, type Logger } from "./lib/ports"
import {
  repositoryEngineDeps,
  repositorySnapshotRecords,
} from "./lib/repository-deps"

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value
const optional = z.preprocess(blankToUndefined, z.string().trim().optional())
const withDefault = (value: string) =>
  z.preprocess(blankToUndefined, z.string().default(value))

export const awsDepsEnvSchema = z.object({
  VISITPROOF_MODE: z.preprocess(
    blankToUndefined,
    z.enum(["demo", "live"]).default("demo")
  ),
  VISITPROOF_STORE: z.preprocess(
    blankToUndefined,
    z.enum(["dynamodb", "local"]).default("local")
  ),
  VISITPROOF_DEMO_STORE_PATH: withDefault(".visitproof/demo-store"),
  VISITPROOF_AGENCY_ID: withDefault("a1"),
  VISITPROOF_LOCAL_LEDGER_SECRET: withDefault("visitproof-local-demo-ledger"),
  AWS_REGION: withDefault("us-east-1"),
  DYNAMODB_TABLE: withDefault("visitproof"),
  MODEL_PROVIDER: z.preprocess(
    blankToUndefined,
    z.enum(["fixture", "bedrock"]).default("fixture")
  ),
  BEDROCK_MODEL_ID: withDefault(DEFAULT_BEDROCK_MODEL_ID),
  BEDROCK_GUARDRAIL_ID: optional,
  BEDROCK_GUARDRAIL_VERSION: optional,
  KMS_SIGNING_KEY_ID: optional,
  SES_FROM_ADDRESS: z.preprocess(blankToUndefined, z.email().optional()),
  SES_ALLOWED_RECIPIENTS: optional,
  S3_SNAPSHOT_BUCKET: optional,
  RING_PLAYGROUND_ACCESS_TOKEN: optional,
  RING_API_BASE: withDefault("https://api.amazonvision.com"),
})
export type AwsDepsEnv = z.infer<typeof awsDepsEnvSchema>

export interface AdapterMatrix {
  store: "dynamodb" | "local"
  narrator: "bedrock" | "template"
  signer: "kms" | "local-hmac"
  mail: "ses" | "console"
  snapshots: "ring-s3" | "disabled"
  evidence: "s3" | "memory"
}

export interface AwsDeps {
  deps: EngineDeps
  repository: VisitProofRepository
  signer: AsyncLedgerSigner
  adapters: AdapterMatrix
}

/** Injected SDK clients (tests pass aws-sdk-client-mock instances). */
export interface AwsClients {
  bedrock?: Pick<BedrockRuntimeClient, "send">
  kms?: Pick<KMSClient, "send">
  s3?: Pick<S3Client, "send">
  ses?: Pick<SESClient, "send">
  repository?: VisitProofRepository
  logger?: Logger
}

function createRepository(
  env: AwsDepsEnv,
  clients: AwsClients
): VisitProofRepository {
  if (clients.repository) return clients.repository
  return env.VISITPROOF_STORE === "dynamodb"
    ? createDynamoRepository({
        config: { tableName: env.DYNAMODB_TABLE, region: env.AWS_REGION },
      })
    : createLocalRepository(env.VISITPROOF_DEMO_STORE_PATH)
}

function createSigner(env: AwsDepsEnv, clients: AwsClients): AsyncLedgerSigner {
  if (env.KMS_SIGNING_KEY_ID !== undefined) {
    const kms = clients.kms ?? new KMSClient({ region: env.AWS_REGION })
    return createKmsLedgerSigner({ client: kms, keyId: env.KMS_SIGNING_KEY_ID })
  }
  if (env.VISITPROOF_MODE === "live") {
    throw new Error(
      "KMS_SIGNING_KEY_ID is required in live mode; the local HMAC signer is demo only"
    )
  }
  return createLocalHmacLedgerSigner({
    secret: env.VISITPROOF_LOCAL_LEDGER_SECRET,
  })
}

function guardrailOf(
  env: AwsDepsEnv
): { id: string; version: string } | undefined {
  const { BEDROCK_GUARDRAIL_ID: id, BEDROCK_GUARDRAIL_VERSION: version } = env
  if (id === undefined && version === undefined) return undefined
  if (id === undefined || version === undefined) {
    throw new Error(
      "set both BEDROCK_GUARDRAIL_ID and BEDROCK_GUARDRAIL_VERSION, or neither"
    )
  }
  return { id, version }
}

function createNarrator(env: AwsDepsEnv, clients: AwsClients, logger: Logger) {
  if (env.MODEL_PROVIDER !== "bedrock") return templateNarrator
  const guardrail = guardrailOf(env)
  return createBedrockNarrator({
    client:
      clients.bedrock ?? new BedrockRuntimeClient({ region: env.AWS_REGION }),
    modelId: env.BEDROCK_MODEL_ID,
    logger,
    ...(guardrail ? { guardrail } : {}),
  })
}

function createMail(env: AwsDepsEnv, clients: AwsClients, logger: Logger) {
  if (env.SES_FROM_ADDRESS === undefined) return consoleMailTransport
  const allowed = env.SES_ALLOWED_RECIPIENTS?.split(",")
    .map((a) => a.trim())
    .filter(Boolean)
  return createSesMailTransport({
    client: clients.ses ?? new SESClient({ region: env.AWS_REGION }),
    fromAddress: env.SES_FROM_ADDRESS,
    logger,
    ...(allowed !== undefined ? { allowedRecipients: allowed } : {}),
  })
}

interface MediaWiring {
  env: AwsDepsEnv
  s3: Pick<S3Client, "send"> | undefined
  base: EngineDeps
  repository: VisitProofRepository
  logger: Logger
}

function createSnapshots({ env, s3, base, repository, logger }: MediaWiring) {
  const bucket = env.S3_SNAPSHOT_BUCKET
  const token = env.RING_PLAYGROUND_ACCESS_TOKEN
  if (s3 === undefined || bucket === undefined || token === undefined) {
    return new NoopSnapshotService()
  }
  return new RingS3SnapshotService({
    ring: new RingClient({
      baseUrl: env.RING_API_BASE,
      getAccessToken: () => token,
    }),
    s3,
    bucket,
    clients: base.clients,
    events: base.events,
    records: repositorySnapshotRecords(repository),
    clock: base.clock,
    logger,
  })
}

export function createAwsDeps(
  source: Readonly<Record<string, string | undefined>>,
  clients: AwsClients = {}
): AwsDeps {
  const env = awsDepsEnvSchema.parse(source)
  const logger = clients.logger ?? consoleLogger
  const repository = createRepository(env, clients)
  const bucket = env.S3_SNAPSHOT_BUCKET
  const s3 =
    bucket === undefined
      ? undefined
      : (clients.s3 ?? new S3Client({ region: env.AWS_REGION }))
  const base = repositoryEngineDeps(repository, env.VISITPROOF_AGENCY_ID)
  const snapshots = createSnapshots({ env, s3, base, repository, logger })
  const narrator = createNarrator(env, clients, logger)
  const mail = createMail(env, clients, logger)
  const evidence =
    s3 !== undefined && bucket !== undefined
      ? createS3EvidenceStore({ s3, bucket })
      : new InMemoryEvidenceStore()
  const signer = createSigner(env, clients)
  return {
    deps: {
      ...base,
      narrator,
      mail,
      snapshots,
      evidence,
      logger,
      ledger: repositoryLedger(repository, signer),
    },
    repository,
    signer,
    adapters: {
      store: env.VISITPROOF_STORE,
      narrator: narrator.name,
      signer: signer.kind,
      mail: mail === consoleMailTransport ? "console" : "ses",
      snapshots:
        snapshots instanceof RingS3SnapshotService ? "ring-s3" : "disabled",
      evidence: s3 !== undefined ? "s3" : "memory",
    },
  }
}
