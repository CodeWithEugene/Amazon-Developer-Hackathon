import { z } from "zod"

/**
 * What "Sync Ring History" tells the family after a sync. Client safe (no
 * Node imports). An empty result is a normal outcome, not an error: the Ring
 * Playground sandbox doorbell, for example, has no recorded motion or
 * doorbell events, and Ring answers 200 with an empty page.
 */

export const historySyncResponseSchema = z.object({
  result: z
    .object({
      devices: z.number().int().nonnegative().optional(),
      fetched: z.number().int().nonnegative(),
      saved: z.number().int().nonnegative(),
      alreadyStored: z.number().int().nonnegative(),
    })
    .optional(),
  source: z.enum(["playground", "linked"]).optional(),
  provenance: z.string().optional(),
  error: z.string().optional(),
})
export type HistorySyncResponse = z.infer<typeof historySyncResponseSchema>

export interface HistorySyncNotice {
  readonly type: "success" | "info"
  readonly title: string
  readonly description: string
}

type SyncResult = NonNullable<HistorySyncResponse["result"]>

const emptyNotice = (source: HistorySyncResponse["source"]): HistorySyncNotice => ({
  type: "info",
  title: "No Ring Events Since Consent",
  description:
    source === "playground"
      ? "Ring returned no events for this device since consent. The Playground sandbox doorbell has no recorded motion or doorbell events, so there is nothing to add yet."
      : "Ring returned no events for your shared doorbells since consent. New arrivals and departures will appear here as Ring records them.",
})

export const historySyncNotice = (result: SyncResult, response: Pick<HistorySyncResponse, "source" | "provenance"> = {}): HistorySyncNotice => {
  if (result.fetched === 0) return emptyNotice(response.source)
  const from = response.provenance ?? "Ring"
  return {
    type: "success",
    title: "Ring History Synced",
    description: `${result.saved} new ${result.saved === 1 ? "event" : "events"} saved from ${from}. ${result.alreadyStored} ${result.alreadyStored === 1 ? "was" : "were"} already stored.`,
  }
}
