import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"

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

import { dbConfigSchema, type DbConfig } from "./config"
import {
  createDocumentClient,
  createTableClient,
  type Stored,
} from "./dynamo/table-client"
import { isConditionalCheckFailure, MalformedDataError } from "./errors"
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
import type { VisitProofRepository } from "./repository"
import { ttlAt } from "./time"
import { WEBHOOK_RECEIPT_TTL_SECONDS } from "./table"
import { storedParser, type EntityName } from "./validation"

export {
  createDocumentClient,
  DOCUMENT_TRANSLATE_CONFIG,
} from "./dynamo/table-client"

export interface DynamoRepositoryOptions {
  /**
   * An injected document client (tests inject a mock). Build production
   * clients with `createDocumentClient` so `removeUndefinedValues` is set.
   */
  readonly client?: DynamoDBDocumentClient
  /** Table config; validated with `dbConfigSchema`. */
  readonly config?: Partial<DbConfig>
  /**
   * Validate every item read against its domain schema (default true). A row
   * that fails raises `MalformedDataError`.
   */
  readonly validate?: boolean
}

const sortDesc = <T>(items: readonly T[], by: (item: T) => string): T[] =>
  [...items].sort((a, b) => (by(a) < by(b) ? 1 : by(a) > by(b) ? -1 : 0))

/**
 * Production repository over the single `visitproof` DynamoDB table using
 * `@aws-sdk/lib-dynamodb` (document client, native JSON marshalling).
 */
export const createDynamoRepository = (
  options: DynamoRepositoryOptions = {}
): VisitProofRepository => {
  const config = dbConfigSchema.parse(options.config ?? {})
  const table = createTableClient(
    options.client ?? createDocumentClient(config),
    config.tableName
  )
  const validate = options.validate ?? true

  const as =
    <T>(entity: EntityName) =>
    (item: Stored): T =>
      storedParser(entity, validate)(item) as T
  const asAll =
    <T>(entity: EntityName) =>
    (items: readonly Stored[]): T[] =>
      items.map(as<T>(entity))
  const orNull = <T>(entity: EntityName, item: Stored | undefined): T | null =>
    item === undefined ? null : as<T>(entity)(item)

  const clientItems = async (clientId: Id, prefix: string) =>
    table.queryBySkPrefix(`CLIENT#${clientId}`, prefix)
  const agencyItems = async (agencyId: Id, prefix: string) =>
    table.queryBySkPrefix(`AGENCY#${agencyId}`, prefix)

  return {
    agencies: {
      async put(agency) {
        await table.putItem(agencyKeys(agency.id), agency)
      },
      async get(agencyId) {
        return orNull<Agency>(
          "agency",
          await table.getItem(agencyKeys(agencyId))
        )
      },
    },

    visits: {
      async put(visit) {
        await table.putItem(visitKeys(visit), visit, visitGsi1(visit))
      },
      async get(clientId, visitId) {
        const items = await clientItems(clientId, "VISIT#")
        return orNull<Visit>(
          "visit",
          items.find((i) => i.id === visitId)
        )
      },
      async byClient(clientId) {
        const visits = asAll<Visit>("visit")(
          await clientItems(clientId, "VISIT#")
        )
        return sortDesc(visits, (v) => visitKeys(v).sk)
      },
      async byAgencyAndDate(agencyId, date) {
        const items = await table.queryGsi1(
          `AGENCY#${agencyId}`,
          `DATE#${date}#`
        )
        return asAll<Visit>("visit")(items).sort((a, b) =>
          visitGsi1(a).gsi1sk < visitGsi1(b).gsi1sk ? -1 : 1
        )
      },
    },

    events: {
      async put(event) {
        try {
          await table.putItem(
            eventKeys(event),
            event,
            {},
            "attribute_not_exists(#pk)"
          )
        } catch (error) {
          // Ring retries carry the same request id: absorb them idempotently.
          if (!isConditionalCheckFailure(error)) throw error
        }
      },
      async byClient(clientId, query) {
        const events = asAll<DoorEvent>("event")(
          await clientItems(clientId, "EVENT#")
        )
        const filtered = events
          .filter(
            (e) =>
              query?.sinceMs === undefined || e.timestampMs >= query.sinceMs
          )
          .sort((a, b) => a.timestampMs - b.timestampMs)
        const limit = query?.limit
        return limit === undefined ? filtered : filtered.slice(0, limit)
      },
      async deleteByClient(clientId) {
        const items = await clientItems(clientId, "EVENT#")
        return table.deleteKeys(items.map((i) => ({ pk: i.pk, sk: i.sk })))
      },
    },

    exceptions: {
      async put(exception) {
        await table.putItem(
          exceptionKeys(exception),
          exception,
          exceptionGsi1(exception)
        )
      },
      async get(agencyId, exceptionId) {
        const items = await agencyItems(agencyId, "EXC#")
        return orNull<Exception>(
          "exception",
          items.find((i) => i.id === exceptionId)
        )
      },
      async byAgency(agencyId, state) {
        const items = asAll<Exception>("exception")(
          await agencyItems(agencyId, "EXC#")
        )
        return sortDesc(
          items.filter((e) => state === undefined || e.state === state),
          (e) => exceptionGsi1(e).gsi1sk
        )
      },
    },

    caregivers: {
      async put(caregiver) {
        await table.putItem(caregiverKeys(caregiver), caregiver)
      },
      async get(agencyId, caregiverId) {
        const item = await table.getItem(
          caregiverKeys({ agencyId, id: caregiverId })
        )
        return orNull<Caregiver>("caregiver", item)
      },
      async byAgency(agencyId) {
        return asAll<Caregiver>("caregiver")(
          await agencyItems(agencyId, "CAREGIVER#")
        )
      },
    },

    clients: {
      async put(client) {
        await table.putItem(clientKeys(client), client)
      },
      async get(agencyId, clientId) {
        const item = await table.getItem(clientKeys({ agencyId, id: clientId }))
        return orNull<Client>("client", item)
      },
      async byAgency(agencyId) {
        return asAll<Client>("client")(await agencyItems(agencyId, "CLIENT#"))
      },
      async saveConsent(agencyId, clientId, consent, now) {
        const key = clientKeys({ agencyId, id: clientId })
        const client = orNull<Client>("client", await table.getItem(key))
        if (client === null) {
          throw new MalformedDataError(`client not found: ${clientId}`)
        }
        const updated: Client = {
          ...client,
          consent,
          updatedAt: now.toISOString(),
          version: client.version + 1,
        }
        await table.putItem(key, updated)
        return updated
      },
    },

    ringLinks: {
      async link(clientId, accountId) {
        await table.putItem(ringAccountKeys(accountId), { clientId })
      },
      async unlink(accountId) {
        await table.deleteItem(ringAccountKeys(accountId))
      },
      async clientIdFor(accountId) {
        const row = orNull<{ clientId: Id }>(
          "ringAccount",
          await table.getItem(ringAccountKeys(accountId))
        )
        return row?.clientId ?? null
      },
    },

    evvRecords: {
      async put(record) {
        await table.putItem(evvKeys(record), record)
      },
      async get(clientId, recordId) {
        const items = await clientItems(clientId, "EVV#")
        return orNull<EVVRecord>(
          "evv",
          items.find((i) => i.id === recordId)
        )
      },
      async byClient(clientId) {
        return asAll<EVVRecord>("evv")(await clientItems(clientId, "EVV#"))
      },
    },

    evidence: {
      async putNote(note) {
        await table.putItem(noteKeys(note), note)
      },
      async notesByVisit(visitId) {
        const items = await table.queryBySkPrefix(`VISIT#${visitId}`, "NOTE#")
        return sortDesc(asAll<Note>("note")(items), (n) => n.at)
      },
      async putSnapshot(snapshot) {
        await table.putItem(snapshotKeys(snapshot), snapshot)
      },
      async snapshotsByVisit(visitId) {
        const items = await table.queryBySkPrefix(`VISIT#${visitId}`, "SNAP#")
        return sortDesc(asAll<Snapshot>("snapshot")(items), (s) => s.at)
      },
      async deleteByVisit(visitId) {
        const notes = await table.queryBySkPrefix(`VISIT#${visitId}`, "NOTE#")
        const snaps = await table.queryBySkPrefix(`VISIT#${visitId}`, "SNAP#")
        const toKey = (i: Stored) => ({ pk: i.pk, sk: i.sk })
        return {
          notes: await table.deleteKeys(notes.map(toKey)),
          snapshots: await table.deleteKeys(snaps.map(toKey)),
        }
      },
      async appendLedger(record) {
        await table.putItem(
          ledgerKeys(record),
          record,
          {},
          "attribute_not_exists(#pk)"
        )
      },
      async ledgerByClient(clientId) {
        const items = await clientItems(clientId, "LEDGER#")
        return asAll<LedgerRecord>("ledger")(items).sort(
          (a, b) => a.seq - b.seq
        )
      },
    },

    webhookReceipts: {
      async claim(requestId, now) {
        try {
          await table.putItem(
            webhookReceiptKeys(requestId),
            { requestId },
            { expiresAt: ttlAt(now, WEBHOOK_RECEIPT_TTL_SECONDS) },
            "attribute_not_exists(#pk)"
          )
          return true
        } catch (error) {
          if (isConditionalCheckFailure(error)) return false
          throw error
        }
      },
    },
  }
}
