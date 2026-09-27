/**
 * Snapshot fetcher. Requests a snapshot 15 seconds after an observed arrival,
 * only when family consent allows snapshots (watermark stays intact).
 */
import type { EngineDeps } from "../lib/ports"

export const handlerName = "snapshot-fetcher"

const SNAPSHOT_DELAY_MS = 15_000

export function createSnapshotFetcher(deps: EngineDeps) {
  return async function snapshotFetcher(): Promise<void> {
    const now = deps.clock.now()
    const visits = await deps.visits.listActive()
    for (const visit of visits) {
      if (!visit.arrival) continue
      const client = await deps.clients.get(visit.clientId)
      if (!client?.consent.snapshotsEnabled) continue
      const eligibleAt = Date.parse(visit.arrival.at) + SNAPSHOT_DELAY_MS
      if (now.getTime() < eligibleAt) continue
      await deps.snapshots.request(visit)
    }
  }
}
