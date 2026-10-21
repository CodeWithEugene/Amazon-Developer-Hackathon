/**
 * The signed evidence ledger over a `VisitProofRepository` (EARS rule 10).
 * Each append reads the client's chain tip, signs the next record with the
 * injected signer (KMS in production, the local HMAC stand-in in demo
 * mode), and appends it. The repository rejects a seq that already exists,
 * so a concurrent writer causes a re-read and a retry, never a fork.
 */
import type { VisitProofRepository } from "@visitproof/db"

import {
  signLedgerWith,
  type AsyncLedgerSigner,
} from "../adapters/ledger-signers"
import type { EvidenceLedger } from "./ports"

const MAX_APPEND_ATTEMPTS = 4

const isSeqConflict = (error: unknown): boolean =>
  error instanceof Error &&
  (error.message.includes("ledger seq already exists") ||
    error.name === "ConditionalCheckFailedException")

export function repositoryLedger(
  repository: Pick<VisitProofRepository, "evidence">,
  signer: AsyncLedgerSigner
): EvidenceLedger {
  return {
    async append(entry) {
      for (let attempt = 1; ; attempt += 1) {
        const prev = (
          await repository.evidence.ledgerByClient(entry.clientId)
        ).at(-1)
        const record = await signLedgerWith(signer, {
          clientId: entry.clientId,
          seq: (prev?.seq ?? 0) + 1,
          column: entry.column,
          subject: entry.subject,
          payload: entry.payload,
          at: entry.at.toISOString(),
          ...(prev ? { prev } : {}),
        })
        try {
          await repository.evidence.appendLedger(record)
          return
        } catch (error) {
          if (!isSeqConflict(error) || attempt >= MAX_APPEND_ATTEMPTS)
            throw error
        }
      }
    },
  }
}
