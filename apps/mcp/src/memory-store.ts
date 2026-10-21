import type { VisitProofRepository } from "@visitproof/db"
import type {
  Caregiver,
  Client,
  DoorEvent,
  EVVRecord,
  Exception,
  LedgerRecord,
  Note,
  Snapshot,
  Visit,
} from "@visitproof/domain"

import type { FixtureSeed } from "./fixtures"

/**
 * In-memory `VisitProofRepository` for the offline fixture server and tests.
 * Each table is an immutable array swapped on write, so readers never see a
 * half-applied update. Production and the demo use `@visitproof/db`.
 */
class Table<T> {
  private rows: readonly T[]

  constructor(
    initial: readonly T[],
    private readonly same: (a: T, b: T) => boolean,
  ) {
    this.rows = [...initial]
  }

  all(): T[] {
    return [...this.rows]
  }

  upsert(row: T): void {
    this.rows = [...this.rows.filter((existing) => !this.same(existing, row)), row]
  }

  find(predicate: (row: T) => boolean): T | null {
    return this.rows.find(predicate) ?? null
  }
}

const byStartAsc = (a: Visit, b: Visit) => a.scheduledStart.localeCompare(b.scheduledStart)

export const createMemoryStore = (seed: FixtureSeed): VisitProofRepository => {
  const visits = new Table<Visit>(seed.visits, (a, b) => a.clientId === b.clientId && a.id === b.id)
  const events = new Table<DoorEvent>(seed.events, (a, b) => a.clientId === b.clientId && a.requestId === b.requestId)
  const exceptions = new Table<Exception>(seed.exceptions, (a, b) => a.agencyId === b.agencyId && a.id === b.id)
  const caregivers = new Table<Caregiver>(seed.caregivers, (a, b) => a.agencyId === b.agencyId && a.id === b.id)
  const clients = new Table<Client>(seed.clients, (a, b) => a.agencyId === b.agencyId && a.id === b.id)
  const evv = new Table<EVVRecord>([], (a, b) => a.clientId === b.clientId && a.id === b.id)
  const notes = new Table<Note>(seed.notes, (a, b) => a.id === b.id)
  const snapshots = new Table<Snapshot>([], (a, b) => a.visitId === b.visitId && a.at === b.at)
  const ledger = new Table<LedgerRecord>(seed.ledger, (a, b) => a.clientId === b.clientId && a.seq === b.seq)
  const links = new Map<string, string>()
  const receipts = new Set<string>()

  return {
    visits: {
      async put(visit) { visits.upsert(visit) },
      async get(clientId, visitId) { return visits.find((v) => v.clientId === clientId && v.id === visitId) },
      async byClient(clientId) { return visits.all().filter((v) => v.clientId === clientId).sort(byStartAsc).reverse() },
      async byAgencyAndDate(agencyId, date) {
        return visits.all().filter((v) => v.agencyId === agencyId && v.scheduledStart.slice(0, 10) === date).sort(byStartAsc)
      },
    },
    events: {
      async put(event) { events.upsert(event) },
      async byClient(clientId, options) {
        const rows = events.all()
          .filter((e) => e.clientId === clientId && (options?.sinceMs === undefined || e.timestampMs >= options.sinceMs))
          .sort((a, b) => a.timestampMs - b.timestampMs)
        return options?.limit === undefined ? rows : rows.slice(0, options.limit)
      },
    },
    exceptions: {
      async put(exception) { exceptions.upsert(exception) },
      async get(agencyId, id) { return exceptions.find((e) => e.agencyId === agencyId && e.id === id) },
      async byAgency(agencyId, state) {
        return exceptions.all()
          .filter((e) => e.agencyId === agencyId && (state === undefined || e.state === state))
          .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
      },
    },
    caregivers: {
      async put(row) { caregivers.upsert(row) },
      async get(agencyId, id) { return caregivers.find((c) => c.agencyId === agencyId && c.id === id) },
      async byAgency(agencyId) { return caregivers.all().filter((c) => c.agencyId === agencyId) },
    },
    clients: {
      async put(row) { clients.upsert(row) },
      async get(agencyId, id) { return clients.find((c) => c.agencyId === agencyId && c.id === id) },
      async byAgency(agencyId) { return clients.all().filter((c) => c.agencyId === agencyId) },
      async saveConsent(agencyId, clientId, consent, now) {
        const current = clients.find((c) => c.agencyId === agencyId && c.id === clientId)
        if (!current) throw new Error(`client not found: ${clientId}`)
        const updated = { ...current, consent, updatedAt: now.toISOString(), version: current.version + 1 }
        clients.upsert(updated)
        return updated
      },
    },
    ringLinks: {
      async link(clientId, accountId) { links.set(accountId, clientId) },
      async unlink(accountId) { links.delete(accountId) },
      async clientIdFor(accountId) { return links.get(accountId) ?? null },
    },
    evvRecords: {
      async put(record) { evv.upsert(record) },
      async get(clientId, id) { return evv.find((r) => r.clientId === clientId && r.id === id) },
      async byClient(clientId) { return evv.all().filter((r) => r.clientId === clientId) },
    },
    evidence: {
      async putNote(note) { notes.upsert(note) },
      async notesByVisit(visitId) { return notes.all().filter((n) => n.visitId === visitId).sort((a, b) => a.at.localeCompare(b.at)) },
      async putSnapshot(snapshot) { snapshots.upsert(snapshot) },
      async snapshotsByVisit(visitId) { return snapshots.all().filter((s) => s.visitId === visitId) },
      async appendLedger(record) {
        if (ledger.find((r) => r.clientId === record.clientId && r.seq === record.seq)) {
          throw new Error(`ledger seq already exists: ${record.clientId}/${record.seq}`)
        }
        ledger.upsert(record)
      },
      async ledgerByClient(clientId) { return ledger.all().filter((r) => r.clientId === clientId).sort((a, b) => a.seq - b.seq) },
    },
    webhookReceipts: {
      async claim(requestId) {
        if (receipts.has(requestId)) return false
        receipts.add(requestId)
        return true
      },
    },
  }
}
