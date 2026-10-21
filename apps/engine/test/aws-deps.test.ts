import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime"
import { KMSClient } from "@aws-sdk/client-kms"
import { S3Client } from "@aws-sdk/client-s3"
import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses"
import { createLocalRepository } from "@visitproof/db"
import { mockClient } from "aws-sdk-client-mock"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createAwsDeps } from "../src"
import { silentLogger, testClient, testVisit } from "./helpers"

const bedrock = mockClient(BedrockRuntimeClient)
const ses = mockClient(SESClient)
afterEach(() => {
  bedrock.reset()
  ses.reset()
})

const localRepo = async () =>
  createLocalRepository(await mkdtemp(join(tmpdir(), "engine-aws-deps-")))

describe("createAwsDeps adapter matrix", () => {
  it("runs fully offline with no AWS variables", async () => {
    const { adapters, signer } = createAwsDeps(
      {},
      { repository: await localRepo() }
    )
    expect(adapters).toEqual({
      store: "local",
      narrator: "template",
      signer: "local-hmac",
      mail: "console",
      snapshots: "disabled",
      evidence: "memory",
    })
    expect(signer.keyId).toBe("local-demo/ledger-signing-key")
  })

  it("wires the signed ledger so the handlers append as they decide", async () => {
    const repository = await localRepo()
    const { deps } = createAwsDeps({}, { repository })
    await deps.ledger?.append({
      clientId: "c1",
      column: "observed",
      subject: "req-1",
      payload: { kind: "door_event" },
      at: new Date("2026-10-01T12:00:00.000Z"),
    })
    const [record] = await repository.evidence.ledgerByClient("c1")
    expect(record?.signerKeyId).toBe("local-demo/ledger-signing-key")
    expect(record?.seq).toBe(1)
  })

  it("activates every AWS adapter from its env switch (mocked clients, no calls)", async () => {
    const { adapters } = createAwsDeps(
      {
        VISITPROOF_STORE: "dynamodb",
        MODEL_PROVIDER: "bedrock",
        BEDROCK_GUARDRAIL_ID: "gr-1",
        BEDROCK_GUARDRAIL_VERSION: "1",
        KMS_SIGNING_KEY_ID: "alias/visitproof-ledger",
        SES_FROM_ADDRESS: "alerts@visitproof.test",
        S3_SNAPSHOT_BUCKET: "visitproof-media",
        RING_PLAYGROUND_ACCESS_TOKEN: "playground-token",
      },
      {
        bedrock: new BedrockRuntimeClient({}),
        kms: new KMSClient({}),
        s3: new S3Client({}),
        ses: new SESClient({}),
      }
    )
    expect(adapters).toEqual({
      store: "dynamodb",
      narrator: "bedrock",
      signer: "kms",
      mail: "ses",
      snapshots: "ring-s3",
      evidence: "s3",
    })
  })

  it("treats blank variables as unset", async () => {
    const { adapters } = createAwsDeps(
      { KMS_SIGNING_KEY_ID: "", SES_FROM_ADDRESS: " ", S3_SNAPSHOT_BUCKET: "" },
      { repository: await localRepo() }
    )
    expect(adapters.signer).toBe("local-hmac")
    expect(adapters.mail).toBe("console")
    expect(adapters.evidence).toBe("memory")
  })

  it("refuses the local HMAC signer in live mode", async () => {
    expect(() =>
      createAwsDeps({ VISITPROOF_MODE: "live" }, { repository: {} as never })
    ).toThrow(/KMS_SIGNING_KEY_ID is required/)
  })

  it("requires the guardrail id and version together", () => {
    expect(() =>
      createAwsDeps(
        { MODEL_PROVIDER: "bedrock", BEDROCK_GUARDRAIL_ID: "gr-1" },
        { repository: {} as never, bedrock: new BedrockRuntimeClient({}) }
      )
    ).toThrow(/BEDROCK_GUARDRAIL_VERSION/)
  })

  it("wires the narrator and SES into the handlers' deps", async () => {
    const repository = await localRepo()
    await repository.clients.put(testClient({ agencyId: "a1" }))
    await repository.visits.put(
      testVisit({
        status: "completed",
        arrival: { at: "2026-10-01T12:04:00.000Z", source: "rule" },
      })
    )
    bedrock.on(ConverseCommand).resolves({
      output: {
        message: {
          role: "assistant",
          content: [{ text: "A caregiver arrived at 12:04." }],
        },
      },
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      metrics: { latencyMs: 1 },
    })
    ses.on(SendEmailCommand).resolves({})
    const { deps } = createAwsDeps(
      { MODEL_PROVIDER: "bedrock", SES_FROM_ADDRESS: "alerts@visitproof.test" },
      {
        repository,
        bedrock: new BedrockRuntimeClient({}),
        ses: new SESClient({}),
        logger: silentLogger(),
      }
    )
    const [visit] = await deps.visits.listAll()
    const narrative = await deps.narrator?.write({
      visit: visit!,
      now: new Date(),
    })
    expect(narrative?.provenance).toBe("bedrock")
    await deps.mail.send({ to: "priya@example.com", subject: "S", text: "T" })
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(1)
  })
})
