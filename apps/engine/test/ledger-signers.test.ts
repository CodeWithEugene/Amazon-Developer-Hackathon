import { KMSClient, SignCommand, VerifyCommand } from "@aws-sdk/client-kms"
import { ledgerSigningHash, verifyChain } from "@visitproof/domain"
import { mockClient } from "aws-sdk-client-mock"
import { afterEach, describe, expect, it } from "vitest"

import {
  createKmsLedgerSigner,
  createLocalHmacLedgerSigner,
  KMS_SIGNING_ALGORITHM,
  signLedgerWith,
} from "../src"

const kms = mockClient(KMSClient)
afterEach(() => kms.reset())

const input = {
  clientId: "c1",
  seq: 1,
  column: "observed" as const,
  subject: "v1",
  payload: { arrival: "2026-10-01T12:04:00.000Z" },
  at: "2026-10-01T12:04:05.000Z",
}
const DER_SIGNATURE = Uint8Array.from([0x30, 0x44, 1, 2, 3, 4])

describe("KMS ledger signer", () => {
  it("signs the 32-byte signing digest with ECDSA_SHA_256 and returns base64", async () => {
    kms.on(SignCommand).resolves({ Signature: DER_SIGNATURE, KeyId: "key-1" })
    const signer = createKmsLedgerSigner({
      client: new KMSClient({ region: "us-east-1" }),
      keyId: "key-1",
    })
    const record = await signLedgerWith(signer, input)

    const call = kms.commandCalls(SignCommand)[0]?.args[0].input
    expect(call?.KeyId).toBe("key-1")
    expect(call?.MessageType).toBe("DIGEST")
    expect(call?.SigningAlgorithm).toBe(KMS_SIGNING_ALGORITHM)
    expect(Buffer.from(call?.Message ?? []).toString("hex")).toBe(
      ledgerSigningHash(record)
    )
    expect(record.signature).toBe(Buffer.from(DER_SIGNATURE).toString("base64"))
    expect(record.signerKeyId).toBe("key-1")
  })

  it("verifies with KMS Verify and maps an invalid signature to false", async () => {
    kms.on(SignCommand).resolves({ Signature: DER_SIGNATURE })
    const signer = createKmsLedgerSigner({
      client: new KMSClient({}),
      keyId: "key-1",
    })
    const record = await signLedgerWith(signer, input)

    kms.on(VerifyCommand).resolves({ SignatureValid: true })
    expect(await signer.verify(record)).toBe(true)
    const verifyInput = kms.commandCalls(VerifyCommand)[0]?.args[0].input
    expect(
      Buffer.from(verifyInput?.Signature ?? []).equals(
        Buffer.from(DER_SIGNATURE)
      )
    ).toBe(true)

    kms
      .on(VerifyCommand)
      .rejects(
        Object.assign(new Error("invalid"), {
          name: "KMSInvalidSignatureException",
        })
      )
    expect(await signer.verify(record)).toBe(false)
  })

  it("propagates KMS failures other than an invalid signature", async () => {
    kms
      .on(SignCommand)
      .rejects(
        Object.assign(new Error("denied"), { name: "AccessDeniedException" })
      )
    const signer = createKmsLedgerSigner({
      client: new KMSClient({}),
      keyId: "key-1",
    })
    await expect(signLedgerWith(signer, input)).rejects.toThrow("denied")
  })
})

describe("local HMAC ledger signer (demo mode only)", () => {
  it("is labeled local-hmac and round-trips a hash chain", async () => {
    const signer = createLocalHmacLedgerSigner({ secret: "demo" })
    expect(signer.kind).toBe("local-hmac")
    const first = await signLedgerWith(signer, input)
    const second = await signLedgerWith(signer, {
      ...input,
      seq: 2,
      prev: first,
    })
    const valid = await Promise.all(
      [first, second].map((r) => signer.verify(r))
    )
    expect(valid).toEqual([true, true])
    expect(verifyChain([first, second], () => true)).toBe(true)
    expect(await signer.verify({ ...second, subject: "tampered" })).toBe(false)
  })
})
