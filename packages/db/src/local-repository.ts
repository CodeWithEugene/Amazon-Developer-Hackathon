import { readFile } from "node:fs/promises"
import { join } from "node:path"

import type {
  Agency,
  Caregiver,
  Client,
  DoorEvent,
  EVVRecord,
  Exception,
  Id,
  LedgerRecord,
  Note,
  Snapshot,
  Visit,
} from "@visitproof/domain"

import {
  agencyKeys,
  caregiverKeys,
  clientKeys,
  eventKeys,
  evvKeys,
  exceptionGsi1,
  exceptionKeys,
  ledgerKeys,
  noteKeys,
  ringAccountKeys,
  snapshotKeys,
  visitGsi1,
  visitKeys,
  webhookReceiptKeys,
} from "./keys"
import type { FileLockOptions } from "./local/file-lock"
import { JsonTable } from "./local/json-table"
import type { VisitProofRepository } from "./repository"
import { ttlAt } from "./time"
import { WEBHOOK_RECEIPT_TTL_SECONDS } from "./table"
import { parseStored, storedParser, type EntityName } from "./validation"

export interface LocalRepositoryOptions {
  /** Injected clock; defaults to the system clock. */
  readonly clock?: () => Date
  /**
   * Validate every stored item against its domain schema on read (default
   * true). A row that fails raises `MalformedDataError`.
   */
  readonly validate?: boolean
  /** Cross-process lock tuning (tests shorten the stale timeout). */
  readonly lock?: FileLockOptions
}

/** The single-object agency file the demo script and console share. */
const LEGACY_AGENCY_FILE = "agency.json"

const sortDesc = <T>(items: readonly T[], by: (item: T) => string): T[] =>
  [...items].sort((a, b) => (by(a) < by(b) ? 1 : by(a) > by(b) ? -1 : 0))

const readLegacyAgency = async (
  dirPath: string,
  agencyId: Id,
  validate: boolean
): Promise<Agency | null> => {
  let raw: string
  try {
    raw = await readFile(join(dirPath, LEGACY_AGENCY_FILE), "utf8")
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return null
    throw error
  }
  const parsed: unknown = JSON.parse(raw)
  const agency = (validate ? parseStored("agency", parsed) : parsed) as Agency
  return agency.id === agencyId ? agency : null
}

/**
 * Repository backed by JSON files on disk (one per table). No AWS SDK, no
 * network: the shape the offline demo and the vitest suites run against.
 * Safe for several processes sharing `dirPath` (see `local/json-table.ts`).
 */
export const createLocalRepository = (
  dirPath: string,
  options: LocalRepositoryOptions = {}
): VisitProofRepository => {
  const now = options.clock ?? (() => new Date())
  const validate = options.validate ?? true
  const table = <T>(name: string, entity: EntityName) =>
    new JsonTable<T>(join(dirPath, `${name}.json`), {
      now,
      parse: storedParser(entity, validate),
      ...(options.lock !== undefined ? { lock: options.lock } : {}),
    })

  const agenciesTable = table<Agency>("agencies", "agency")
  const visitsTable = table<Visit>("visits", "visit")
  const eventsTable = table<DoorEvent>("events", "event")
  const exceptionsTable = table<Exception>("exceptions", "exception")
  const caregiversTable = table<Caregiver>("caregivers", "caregiver")
  const clientsTable = table<Client>("clients", "client")
  const ringAccountsTable = table<{ clientId: Id }>(
    "ring-accounts",
    "ringAccount"
  )
  const evvTable = table<EVVRecord>("evv-records", "evv")
  const notesTable = table<Note>("notes", "note")
  const snapshotsTable = table<Snapshot>("snapshots", "snapshot")
  const ledgerTable = table<LedgerRecord>("ledger", "ledger")
  const receiptsTable = table<{ requestId: string }>(
    "webhook-receipts",
    "webhookReceipt"
  )

  return {
    agencies: {
      async put(agency) {
        await agenciesTable.put(agencyKeys(agency.id), agency)
      },
      async get(agencyId) {
        const stored = await agenciesTable.get(agencyKeys(agencyId))
        return stored ?? readLegacyAgency(dirPath, agencyId, validate)
      },
    },

    visits: {
      async put(visit) {
        await visitsTable.put(visitKeys(visit), visit)
      },
      async get(clientId, visitId) {
        const rows = await visitsTable.all()
        return (
          rows.find((v) => v.clientId === clientId && v.id === visitId) ?? null
        )
      },
      async byClient(clientId) {
        const rows = await visitsTable.all()
        return sortDesc(
          rows.filter((v) => v.clientId === clientId),
          (v) => visitKeys(v).sk
        )
      },
      async byAgencyAndDate(agencyId, date) {
        const rows = await visitsTable.all()
        return rows
          .filter((v) => v.agencyId === agencyId)
          .filter((v) => visitGsi1(v).gsi1sk.startsWith(`DATE#${date}#`))
          .sort((a, b) => (visitGsi1(a).gsi1sk < visitGsi1(b).gsi1sk ? -1 : 1))
      },
    },

    events: {
      async put(event) {
        // Ring retries reuse the request id: the first delivery wins.
        await eventsTable.putIfAbsent(eventKeys(event), event)
      },
      async byClient(clientId, query) {
        const rows = await eventsTable.all()
        const filtered = rows
          .filter((e) => e.clientId === clientId)
          .filter(
            (e) =>
              query?.sinceMs === undefined || e.timestampMs >= query.sinceMs
          )
          .sort((a, b) => a.timestampMs - b.timestampMs)
        const limit = query?.limit
        return limit === undefined ? filtered : filtered.slice(0, limit)
      },
      async deleteByClient(clientId) {
        return eventsTable.deleteWhere((e) => e.clientId === clientId)
      },
    },

    exceptions: {
      async put(exception) {
        await exceptionsTable.put(exceptionKeys(exception), exception)
      },
      async get(agencyId, exceptionId) {
        const rows = await exceptionsTable.all()
        return (
          rows.find((e) => e.agencyId === agencyId && e.id === exceptionId) ??
          null
        )
      },
      async byAgency(agencyId, state) {
        const rows = await exceptionsTable.all()
        return sortDesc(
          rows
            .filter((e) => e.agencyId === agencyId)
            .filter((e) => state === undefined || e.state === state),
          (e) => exceptionGsi1(e).gsi1sk
        )
      },
    },

    caregivers: {
      async put(caregiver) {
        await caregiversTable.put(caregiverKeys(caregiver), caregiver)
      },
      async get(agencyId, caregiverId) {
        return caregiversTable.get(caregiverKeys({ agencyId, id: caregiverId }))
      },
      async byAgency(agencyId) {
        const rows = await caregiversTable.all()
        return rows.filter((c) => c.agencyId === agencyId)
      },
    },

    clients: {
      async put(client) {
        await clientsTable.put(clientKeys(client), client)
      },
      async get(agencyId, clientId) {
        return clientsTable.get(clientKeys({ agencyId, id: clientId }))
      },
      async byAgency(agencyId) {
        const rows = await clientsTable.all()
        return rows.filter((c) => c.agencyId === agencyId)
      },
      async saveConsent(agencyId, clientId, consent, at) {
        const updated = await clientsTable.update(
          clientKeys({ agencyId, id: clientId }),
          (client) => ({
            ...client,
            consent,
            updatedAt: at.toISOString(),
            version: client.version + 1,
          })
        )
        if (updated === null) throw new Error(`client not found: ${clientId}`)
        return updated
      },
    },

    ringLinks: {
      async link(clientId, accountId) {
        await ringAccountsTable.put(ringAccountKeys(accountId), { clientId })
      },
      async unlink(accountId) {
        await ringAccountsTable.delete(ringAccountKeys(accountId))
      },
      async clientIdFor(accountId) {
        const row = await ringAccountsTable.get(ringAccountKeys(accountId))
        return row?.clientId ?? null
      },
    },

    evvRecords: {
      async put(record) {
        await evvTable.put(evvKeys(record), record)
      },
      async get(clientId, recordId) {
        const rows = await evvTable.all()
        return (
          rows.find((r) => r.clientId === clientId && r.id === recordId) ?? null
        )
      },
      async byClient(clientId) {
        const rows = await evvTable.all()
        return rows.filter((r) => r.clientId === clientId)
      },
    },

    evidence: {
      async putNote(note) {
        await notesTable.put(noteKeys(note), note)
      },
      async notesByVisit(visitId) {
        const rows = await notesTable.all()
        return sortDesc(
          rows.filter((n) => n.visitId === visitId),
          (n) => n.at
        )
      },
      async putSnapshot(snapshot) {
        await snapshotsTable.put(
          snapshotKeys(snapshot),
          snapshot,
          snapshot.expiresAt
        )
      },
      async snapshotsByVisit(visitId) {
        const rows = await snapshotsTable.all()
        return sortDesc(
          rows.filter((s) => s.visitId === visitId),
          (s) => s.at
        )
      },
      async deleteByVisit(visitId) {
        const notes = await notesTable.deleteWhere((n) => n.visitId === visitId)
        const snapshots = await snapshotsTable.deleteWhere(
          (s) => s.visitId === visitId
        )
        return { notes, snapshots }
      },
      async appendLedger(record) {
        const appended = await ledgerTable.putIfAbsent(
          ledgerKeys(record),
          record
        )
        if (!appended) {
          throw new Error(
            `ledger seq already exists: ${record.clientId}/${record.seq}`
          )
        }
      },
      async ledgerByClient(clientId) {
        const rows = await ledgerTable.all()
        return rows
          .filter((r) => r.clientId === clientId)
          .sort((a, b) => a.seq - b.seq)
      },
    },

    webhookReceipts: {
      async claim(requestId, at) {
        return receiptsTable.putIfAbsent(
          webhookReceiptKeys(requestId),
          { requestId },
          ttlAt(at, WEBHOOK_RECEIPT_TTL_SECONDS)
        )
      },
    },
  }
}
