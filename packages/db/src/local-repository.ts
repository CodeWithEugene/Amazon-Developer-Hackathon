import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import type {
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
  type Key,
} from "./keys"
import { MalformedDataError } from "./errors"
import type { VisitProofRepository } from "./repository"
import { toEpochSeconds, ttlAt } from "./time"
import { WEBHOOK_RECEIPT_TTL_SECONDS } from "./table"

/**
 * One JSON file per table on disk, under the directory given to
 * `createLocalRepository`. This is what the offline demo and the tests use.
 */
class JsonTable<T> {
  private readonly rows = new Map<string, T & { expiresAt?: number }>()

  constructor(
    private readonly filePath: string,
    private readonly now: () => Date
  ) {}

  private keyOf(key: Key): string {
    return `${key.pk}￿${key.sk}`
  }

  private async load(): Promise<void> {
    if (this.rows.size > 0) return
    let raw: string
    try {
      raw = await readFile(this.filePath, "utf8")
    } catch {
      return // absent file: empty table
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (cause) {
      throw new MalformedDataError(`${this.filePath} is not valid JSON`, { cause })
    }
    if (!Array.isArray(parsed)) {
      throw new MalformedDataError(`${this.filePath} must contain an array`)
    }
    const ttl = toEpochSeconds(this.now())
    for (const row of parsed) {
      if (typeof row !== "object" || row === null || !("key" in row)) {
        throw new MalformedDataError(`${this.filePath} has a malformed row`)
      }
      const record = row as { key: unknown; item: T & { expiresAt?: number } }
      if (typeof record.key !== "string" || typeof record.item !== "object") {
        throw new MalformedDataError(`${this.filePath} has a malformed row`)
      }
      const expired =
        record.item.expiresAt !== undefined && record.item.expiresAt <= ttl
      if (!expired) this.rows.set(record.key, record.item)
    }
  }

  private async save(): Promise<void> {
    const rows = [...this.rows.entries()].map(([key, item]) => ({ key, item }))
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(rows, null, 2)}\n`, "utf8")
  }

  async get(key: Key): Promise<(T & { expiresAt?: number }) | null> {
    await this.load()
    return this.rows.get(this.keyOf(key)) ?? null
  }

  async has(key: Key): Promise<boolean> {
    await this.load()
    return this.rows.has(this.keyOf(key))
  }

  async put(key: Key, item: T, expiresAt?: number): Promise<void> {
    await this.load()
    this.rows.set(this.keyOf(key), { ...item, ...(expiresAt !== undefined ? { expiresAt } : {}) })
    await this.save()
  }

  async delete(key: Key): Promise<void> {
    await this.load()
    if (this.rows.delete(this.keyOf(key))) await this.save()
  }

  async all(): Promise<T[]> {
    await this.load()
    return [...this.rows.values()]
  }
}

export interface LocalRepositoryOptions {
  /** Injected clock; defaults to the system clock. */
  readonly clock?: () => Date
}

/**
 * Repository backed by JSON files on disk (one per table). No AWS SDK, no
 * network: the shape the offline demo and the vitest suites run against.
 */
export const createLocalRepository = (
  dirPath: string,
  options: LocalRepositoryOptions = {}
): VisitProofRepository => {
  const now = options.clock ?? (() => new Date())
  const table = <T>(name: string) => new JsonTable<T>(join(dirPath, `${name}.json`), now)

  const visitsTable = table<Visit>("visits")
  const eventsTable = table<DoorEvent>("events")
  const exceptionsTable = table<Exception>("exceptions")
  const caregiversTable = table<Caregiver>("caregivers")
  const clientsTable = table<Client>("clients")
  const ringAccountsTable = table<{ clientId: Id }>("ring-accounts")
  const evvTable = table<EVVRecord>("evv-records")
  const notesTable = table<Note>("notes")
  const snapshotsTable = table<Snapshot>("snapshots")
  const ledgerTable = table<LedgerRecord>("ledger")
  const receiptsTable = table<{ requestId: string }>("webhook-receipts")

  const sortDesc = <T>(items: T[], by: (item: T) => string): T[] =>
    [...items].sort((a, b) => (by(a) < by(b) ? 1 : by(a) > by(b) ? -1 : 0))

  return {
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
        await eventsTable.put(eventKeys(event), event)
      },
      async byClient(clientId, options) {
        const rows = await eventsTable.all()
        const filtered = rows
          .filter((e) => e.clientId === clientId)
          .filter((e) => options?.sinceMs === undefined || e.timestampMs >= options.sinceMs)
          .sort((a, b) => a.timestampMs - b.timestampMs)
        const limit = options?.limit
        return limit === undefined ? filtered : filtered.slice(0, limit)
      },
    },

    exceptions: {
      async put(exception) {
        await exceptionsTable.put(exceptionKeys(exception), exception)
      },
      async get(agencyId, exceptionId) {
        const rows = await exceptionsTable.all()
        return (
          rows.find((e) => e.agencyId === agencyId && e.id === exceptionId) ?? null
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
      async saveConsent(agencyId, clientId, consent) {
        const client = await clientsTable.get(clientKeys({ agencyId, id: clientId }))
        if (!client) throw new Error(`client not found: ${clientId}`)
        const updated: Client = {
          ...client,
          consent,
          updatedAt: now().toISOString(),
          version: client.version + 1,
        }
        await clientsTable.put(clientKeys(updated), updated)
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
        return rows.find((r) => r.clientId === clientId && r.id === recordId) ?? null
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
        await snapshotsTable.put(snapshotKeys(snapshot), snapshot)
      },
      async snapshotsByVisit(visitId) {
        const rows = await snapshotsTable.all()
        return sortDesc(
          rows.filter((s) => s.visitId === visitId),
          (s) => s.at
        )
      },
      async appendLedger(record) {
        const key = ledgerKeys(record)
        if (await ledgerTable.has(key)) {
          throw new Error(`ledger seq already exists: ${record.clientId}/${record.seq}`)
        }
        await ledgerTable.put(key, record)
      },
      async ledgerByClient(clientId) {
        const rows = await ledgerTable.all()
        return rows
          .filter((r) => r.clientId === clientId)
          .sort((a, b) => a.seq - b.seq)
      },
    },

    webhookReceipts: {
      async claim(requestId) {
        const key = webhookReceiptKeys(requestId)
        if (await receiptsTable.has(key)) return false
        await receiptsTable.put(
          key,
          { requestId },
          ttlAt(now(), WEBHOOK_RECEIPT_TTL_SECONDS)
        )
        return true
      },
    },
  }
}
