import type {
  Exception,
  ExceptionState,
  Visit,
  VisitStatus,
} from "@visitproof/domain"

/**
 * Read-only data access for the ops copilot.
 *
 * The copilot codes against this minimal interface and expects it to be
 * injected by the caller (console server action or simulator route).
 * `createDbCopilotAccessor` in `./db-accessor` adapts the real
 * `@visitproof/db` `VisitProofRepository` (the seeded local store in demo,
 * DynamoDB in production) without changing call sites.
 */
export interface VisitFilter {
  /** Inclusive lower bound on `visit.date` (ISO date, `yyyy-mm-dd`). */
  from: string
  /** Inclusive upper bound on `visit.date` (ISO date, `yyyy-mm-dd`). */
  to: string
  statuses?: readonly VisitStatus[]
}

export interface ExceptionFilter {
  state?: ExceptionState
  /** Inclusive bounds on `exception.openedAt` (ISO date, `yyyy-mm-dd`). */
  from?: string
  to?: string
}

export interface CopilotDataAccessor {
  listVisits(filter: VisitFilter): Promise<readonly Visit[]>
  listExceptions(filter: ExceptionFilter): Promise<readonly Exception[]>
  getVisit(visitId: string): Promise<Visit | undefined>
  getException(exceptionId: string): Promise<Exception | undefined>
}
