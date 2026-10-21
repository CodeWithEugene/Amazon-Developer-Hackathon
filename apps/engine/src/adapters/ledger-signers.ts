/**
 * Ledger signers (docs/build.md Section 4, LedgerRecord.signature).
 *
 * The domain `signLedger` takes a synchronous `LedgerSigner`
 * (`(signingHash) => signature`). KMS is asynchronous, so `signLedgerWith`
 * runs `signLedger` once to learn the exact signing hash, signs that hash
 * with the async signer, then runs `signLedger` again with the finished
 * signature. The record layout and chain hashing stay owned by the domain.
 *
 * - `createKmsLedgerSigner`: AWS KMS Sign and Verify, ECDSA_SHA_256 over the
 *   32-byte SHA-256 signing hash (MessageType DIGEST) on the asymmetric
 *   ECC_NIST_P256 SIGN_VERIFY key in KMS_SIGNING_KEY_ID.
 * - `createLocalHmacLedgerSigner`: an HMAC-SHA256 stand-in for demo mode
 *   ONLY. It is not a public-key signature; anyone holding the demo secret
 *   can forge it. Its kind is "local-hmac" so exports can label it.
 */
import { createHmac, timingSafeEqual } from "node:crypto"

import {
  KMSClient,
  SignCommand,
  VerifyCommand,
  type SignCommandOutput,
} from "@aws-sdk/client-kms"
import {
  ledgerSigningHash,
  signLedger,
  type LedgerRecord,
  type SignLedgerInput,
} from "@visitproof/domain"

export const KMS_SIGNING_ALGORITHM = "ECDSA_SHA_256" as const

export interface AsyncLedgerSigner {
  readonly kind: "kms" | "local-hmac"
  readonly keyId: string
  /** Signs the hex SHA-256 signing hash; returns the signature string. */
  sign(signingHashHex: string): Promise<string>
  /** Verifies a stored record's signature over its recomputed signing hash. */
  verify(record: LedgerRecord): Promise<boolean>
}

export type UnsignedLedgerInput = Omit<SignLedgerInput, "sign" | "signerKeyId">

/** Builds a signed, hash-chained ledger record with an async signer. */
export async function signLedgerWith(
  signer: AsyncLedgerSigner,
  input: UnsignedLedgerInput
): Promise<LedgerRecord> {
  let signingHash = ""
  signLedger({
    ...input,
    signerKeyId: signer.keyId,
    sign: (hash) => {
      signingHash = hash
      return "pending"
    },
  })
  const signature = await signer.sign(signingHash)
  return signLedger({
    ...input,
    signerKeyId: signer.keyId,
    sign: () => signature,
  })
}

const digestBytes = (hex: string): Uint8Array => {
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new RangeError(
      "ledger signing hash must be a 64 character hex SHA-256 digest"
    )
  }
  return Uint8Array.from(Buffer.from(hex, "hex"))
}

export function createKmsLedgerSigner(options: {
  client: Pick<KMSClient, "send">
  keyId: string
}): AsyncLedgerSigner {
  const { client, keyId } = options
  return {
    kind: "kms",
    keyId,
    async sign(signingHashHex) {
      const output: SignCommandOutput = await client.send(
        new SignCommand({
          KeyId: keyId,
          Message: digestBytes(signingHashHex),
          MessageType: "DIGEST",
          SigningAlgorithm: KMS_SIGNING_ALGORITHM,
        })
      )
      if (output.Signature === undefined) {
        throw new Error("KMS Sign returned no signature")
      }
      return Buffer.from(output.Signature).toString("base64")
    },
    async verify(record) {
      const output = await client
        .send(
          new VerifyCommand({
            KeyId: record.signerKeyId,
            Message: digestBytes(ledgerSigningHash(record)),
            MessageType: "DIGEST",
            Signature: Uint8Array.from(Buffer.from(record.signature, "base64")),
            SigningAlgorithm: KMS_SIGNING_ALGORITHM,
          })
        )
        .catch((error: unknown) => {
          // KMS answers a bad signature with KMSInvalidSignatureException.
          if (
            error instanceof Error &&
            error.name === "KMSInvalidSignatureException"
          ) {
            return { SignatureValid: false }
          }
          throw error
        })
      return output.SignatureValid === true
    },
  }
}

/** Demo-mode stand-in; matches the console and MCP local HMAC format (hex). */
export function createLocalHmacLedgerSigner(options: {
  secret: string
  keyId?: string
}): AsyncLedgerSigner {
  const keyId = options.keyId ?? "local-demo/ledger-signing-key"
  const mac = (hash: string) =>
    createHmac("sha256", options.secret).update(hash).digest("hex")
  return {
    kind: "local-hmac",
    keyId,
    async sign(signingHashHex) {
      return mac(signingHashHex)
    },
    async verify(record) {
      const expected = Buffer.from(mac(ledgerSigningHash(record)), "hex")
      const actual = Buffer.from(record.signature, "hex")
      return (
        expected.length === actual.length && timingSafeEqual(expected, actual)
      )
    },
  }
}
