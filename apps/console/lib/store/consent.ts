import type { Client } from "@visitproof/domain"

/**
 * Consent policy (contract C3). Pure so every read path and test applies
 * the same rule.
 */

/** The family has run Delete Everything (or unlinked in Ring My Apps). */
export const isErased = (client: Pick<Client, "ringLinkStatus">): boolean =>
  client.ringLinkStatus === "removed"

/** Agency views may show visit details only while the family shares. */
export const agencyCanSee = (
  client: Pick<Client, "ringLinkStatus" | "consent">
): boolean => client.consent.shareWithAgency && !isErased(client)

/** Ids of clients whose details agency views must hide. */
export const hiddenClientIds = (clients: readonly Client[]): Set<string> =>
  new Set(clients.filter((c) => !agencyCanSee(c)).map((c) => c.id))
