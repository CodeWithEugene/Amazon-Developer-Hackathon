import type { VisitProofRepository } from "@visitproof/db"
import type { DoorEvent } from "@visitproof/domain"
import {
  ingestDoorEvent,
  repositoryEngineDeps,
  type EvidenceLedger,
  type Logger,
} from "@visitproof/engine"

import type { EngineHandler } from "./index"

export interface EngineHookOptions {
  /** Engine clock; the wall clock by default. */
  readonly now?: () => Date
  /** Signed evidence ledger the engine appends to (EARS rule 10). */
  readonly ledger?: EvidenceLedger
  readonly logger?: Logger
}

/**
 * Wires the receiver to the real Presence Engine. After the event is durably
 * persisted, the receipt claimed, and the 202 sent, `ingestDoorEvent`
 * applies the pure engine against the same repository the receiver wrote
 * to, with the agency's own tolerances and time zone
 * (`repositoryEngineDeps`). Ports the event path never touches (snapshots,
 * narratives, evidence, mail) keep the engine's inert defaults.
 */
export const createEngineHook = (
  repository: VisitProofRepository,
  agencyId: string,
  options: EngineHookOptions = {}
): EngineHandler => {
  const deps = repositoryEngineDeps(repository, agencyId, {
    clock: { now: options.now ?? (() => new Date()) },
    ...(options.ledger ? { ledger: options.ledger } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
  })
  return async (event: DoorEvent | null) => {
    if (event === null) return
    // The receiver already persisted this event; the engine's append is an
    // idempotent first-write-wins put on (clientId, timestampMs, requestId).
    await ingestDoorEvent(deps, event, { persist: false })
  }
}
