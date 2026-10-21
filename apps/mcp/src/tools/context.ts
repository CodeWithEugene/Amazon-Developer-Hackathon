import type { Client } from "@visitproof/domain"

import { AGENCY_PRINCIPAL, type Principal } from "../auth"
import type { AgencySettings, VisitRepository } from "../repo"
import type { LedgerSignerConfig } from "../signer"
import { localDateKey } from "../time"

/** The outcome of asking the user to confirm a write through elicitation. */
export type ElicitOutcome = "accepted" | "declined"

/** Tool execution context: data, clock, caller, signer, and confirmation. */
export interface ToolContext {
  repo: VisitRepository
  now?: () => Date
  /** The authenticated caller; direct handler calls default to the agency. */
  principal?: Principal
  /** Ledger signer for write tools (the local HMAC stand-in in demo mode). */
  signer?: LedgerSignerConfig
  /** Present only when the connected client declared elicitation support. */
  elicit?: (message: string) => Promise<ElicitOutcome>
}

/** A tool-level refusal (scope, not found): surfaced as an `isError` result. */
export class ToolError extends Error {
  constructor(
    message: string,
    readonly code: "forbidden" | "not_found" | "invalid" | "unavailable",
  ) {
    super(message)
    this.name = "ToolError"
  }
}

export const principalOf = (context: ToolContext): Principal => context.principal ?? AGENCY_PRINCIPAL

export const nowOf = (context: ToolContext): Date => (context.now ? context.now() : new Date())

export interface Clock {
  readonly now: Date
  readonly today: string
  readonly settings: AgencySettings
}

export const clockOf = async (context: ToolContext): Promise<Clock> => {
  const settings = await context.repo.getAgencySettings()
  const now = nowOf(context)
  return { now, today: localDateKey(now, settings.timeZone), settings }
}

/**
 * Resolves the client a tool should act on and enforces the token scope: a
 * family principal can only ever see its own client.
 */
export const resolveClient = async (context: ToolContext, requested?: string): Promise<Client> => {
  const principal = principalOf(context)
  if (principal.kind === "family" && requested && requested !== principal.clientId) {
    throw new ToolError("This account can only see its own family member's visits.", "forbidden")
  }
  const clientId = principal.kind === "family" ? principal.clientId : requested
  const client = clientId ? await context.repo.getClient(clientId) : await context.repo.getDefaultClient()
  if (!client) {
    throw new ToolError("I could not find that client. No visits are being tracked for them.", "not_found")
  }
  return client
}

export const requireAgency = (context: ToolContext, what: string): void => {
  if (principalOf(context).kind !== "agency") {
    throw new ToolError(`Only the agency can ${what}.`, "forbidden")
  }
}

/**
 * Contract C3: the agency may see a household's visit details only while the
 * family shares with the agency and has not removed the Ring link (the same
 * rule as the console's agencyCanSee).
 */
export const agencyMaySee = (client: Client): boolean =>
  client.consent.shareWithAgency && client.ringLinkStatus !== "removed"

/** Agency views hide visit details the family withheld. The family always sees its own data. */
export const detailsHidden = (context: ToolContext, client: Client): boolean =>
  principalOf(context).kind === "agency" && !agencyMaySee(client)

export const firstName = (name: string): string => name.split(" ")[0] ?? name
