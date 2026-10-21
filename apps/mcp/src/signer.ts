import { createHmac } from "node:crypto"

import { ledgerSigningHash, type LedgerRecord } from "@visitproof/domain"

/** Signs a ledger signing digest (KMS ECDSA P-256 in production). */
export interface LedgerSignerConfig {
  readonly keyId: string
  sign(signingHash: string): string
  verify(record: LedgerRecord): boolean
}

/**
 * Local stand-in for the KMS signer, identical to the one the console and
 * `scripts/demo.ts` use, so records the MCP server appends verify in the
 * console's ledger check. Demo mode only.
 */
export const DEMO_LEDGER_KEY_ID = "local-demo/ledger-signing-key"
const DEMO_LEDGER_SECRET = "visitproof-local-demo-ledger"

const hmac = (secret: string, value: string) =>
  createHmac("sha256", secret).update(value).digest("hex")

export const createHmacLedgerSigner = (
  keyId: string,
  secret: string,
): LedgerSignerConfig => ({
  keyId,
  sign: (signingHash) => hmac(secret, signingHash),
  verify: (record) => hmac(secret, ledgerSigningHash(record)) === record.signature,
})

export const DEMO_LEDGER_SIGNER = createHmacLedgerSigner(
  DEMO_LEDGER_KEY_ID,
  DEMO_LEDGER_SECRET,
)
