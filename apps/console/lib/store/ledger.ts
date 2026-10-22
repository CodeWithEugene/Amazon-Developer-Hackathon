import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

import type { VisitProofRepository } from "@visitproof/db"
import {
  ledgerSigningHash,
  signLedger,
  verifyChain,
  type LedgerRecord,
} from "@visitproof/domain"

/**
 * Local stand-in for the KMS ECDSA signer; demo mode only. The secret is
 * read from `VISITPROOF_LEDGER_SECRET` when set; the fallback matches the
 * demo seeder so a fresh `pnpm demo` store verifies.
 */
const DEMO_LEDGER_SECRET = "visitproof-local-demo-ledger"

export const LOCAL_SIGNER_KEY_ID = "local-demo/ledger-signing-key"

const ledgerSecret = (): string =>
  process.env.VISITPROOF_LEDGER_SECRET ?? DEMO_LEDGER_SECRET

const hmac = (digest: string): string =>
  createHmac("sha256", ledgerSecret()).update(digest).digest("hex")

/** The local demo signer over a ledger signing digest. */
export const signLedgerDigest = hmac

const sameHex = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "hex")
  const right = Buffer.from(b, "hex")
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Re-verifies the hash chain and every signature, recomputing the domain's
 * signing digest over each stored record.
 */
export const verifyLedgerRecords = (
  records: readonly LedgerRecord[]
): boolean =>
  verifyChain(records, (record) =>
    sameHex(hmac(ledgerSigningHash(record)), record.signature)
  )

const MAX_APPEND_ATTEMPTS = 4

const isSeqConflict = (error: unknown): boolean =>
  error instanceof Error &&
  (error.message.includes("ledger seq already exists") ||
    error.name === "ConditionalCheckFailedException")

/**
 * Appends one signed record to the client's chain. Another process may
 * append between our read and write, so a seq conflict re-reads the tip and
 * retries; any other failure is thrown to the caller.
 */
export async function appendLedger(
  store: VisitProofRepository,
  clientId: string,
  column: LedgerRecord["column"],
  subject: string,
  payload: unknown
): Promise<LedgerRecord> {
  for (let attempt = 1; ; attempt += 1) {
    const prev = (await store.evidence.ledgerByClient(clientId)).at(-1)
    const record = signLedger({
      clientId,
      seq: (prev?.seq ?? 0) + 1,
      column,
      subject,
      payload,
      signerKeyId: LOCAL_SIGNER_KEY_ID,
      at: new Date().toISOString(),
      ...(prev ? { prev } : {}),
      sign: hmac,
    })
    try {
      await store.evidence.appendLedger(record)
      return record
    } catch (error) {
      if (!isSeqConflict(error) || attempt >= MAX_APPEND_ATTEMPTS) throw error
    }
  }
}
