import "server-only"

/**
 * Console data access, backed by the real `@visitproof/db`
 * `VisitProofRepository`. The offline demo runs on `createLocalRepository`
 * pointed at the seeded demo store at the repo root (see scripts/demo.ts);
 * `VISITPROOF_STORE=dynamo` swaps in `createDynamoRepository` with the same
 * call sites. This module is the stable import surface; the logic lives in
 * focused modules under lib/store/.
 */

export { AGENCY_ID, getStore } from "./store/repository"
export { findRepoRoot, storeDir } from "./store/paths"
export { DEFAULT_AGENCY, getAgency, getAgencyTimeZone } from "./store/agency"
export {
  agencyToday,
  getClient,
  getSessionCaregiverId,
  getSessionClientId,
  getVisit,
  listAllVisits,
  listCaregivers,
  listClients,
  listEvvRecords,
  listExceptions,
  listLedgerRecords,
  listNotes,
  listRecentVisits,
  listVisits,
} from "./store/reads"
export { agencyCanSee, hiddenClientIds, isErased } from "./store/consent"
export { appendLedger, LOCAL_SIGNER_KEY_ID, verifyLedgerRecords } from "./store/ledger"
export {
  backfillVisit,
  recordAgencyCorrection,
  type BackfillInput,
  type CorrectionResult,
} from "./store/backfill"
export { resolveException, snoozeException } from "./store/exceptions"
export { effectiveState, isActive } from "./store/exception-state"
export { addNote, type NoteInput } from "./store/notes"
export {
  deleteClientData,
  exportClientData,
  updateConsent,
  type ConsentPatch,
  type DeletionSummary,
} from "./store/data"
export { buildEvidencePackPdf, toOpenEvvExport } from "./store/exports"
export {
  ConflictError,
  ConsentError,
  NotFoundError,
  StoreError,
  ValidationError,
} from "./store/errors"
