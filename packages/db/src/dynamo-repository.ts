import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb"

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

import { isConditionalCheckFailure, MalformedDataError } from "./errors"
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
import type { VisitProofRepository } from "./repository"
import { dbConfigSchema, TABLE_INDEXES, type DbConfig } from "./config"
import { ttlAt } from "./time"
import { WEBHOOK_RECEIPT_TTL_SECONDS } from "./table"

/** A stored item: the entity attributes plus its key columns. */
type Stored = Record<string, unknown> & { readonly pk: string; readonly sk: string }

export interface DynamoRepositoryOptions {
  /** An injected document client (tests inject a mock). */
  readonly client?: DynamoDBDocumentClient
  /** Table config; validated with `dbConfigSchema`. */
  readonly config?: Partial<DbConfig>
}

const QUERY_PAGE_LIMIT = 200

/**
 * Production repository over the single `visitproof` DynamoDB table using
 * `@aws-sdk/lib-dynamodb` (document client, native JSON marshalling).
 */
export const createDynamoRepository = (
  options: DynamoRepositoryOptions = {}
): VisitProofRepository => {
  const config = dbConfigSchema.parse(options.config ?? {})
  const client =
    options.client ??
    DynamoDBDocumentClient.from(
      new DynamoDBClient({
        region: config.region,
        ...(config.endpoint !== undefined ? { endpoint: config.endpoint } : {}),
      })
    )

  const name = () => config.tableName

  const putItem = async (
    key: Key,
    item: Record<string, unknown>,
    extra: Record<string, unknown> = {},
    condition?: string
  ): Promise<void> => {
    await client.send(
      new PutCommand({
        TableName: name(),
        Item: { ...item, ...extra, pk: key.pk, sk: key.sk },
        // A ConditionExpression referencing #pk without the names map is a
        // ValidationException in production — always pair them.
        ...(condition !== undefined
          ? {
              ConditionExpression: condition,
              ExpressionAttributeNames: { "#pk": "pk" },
            }
          : {}),
      })
    )
  }

  const getItem = async (key: Key): Promise<Stored | undefined> => {
    const result = await client.send(
      new GetCommand({ TableName: name(), Key: { pk: key.pk, sk: key.sk } })
    )
    return result.Item as Stored | undefined
  }

  const deleteItem = async (key: Key): Promise<void> => {
    await client.send(
      new DeleteCommand({ TableName: name(), Key: { pk: key.pk, sk: key.sk } })
    )
  }

  /** All items under a partition, optionally limited to a sort-key prefix. */
  const queryBySkPrefix = async (
    pk: string,
    prefix?: string
  ): Promise<Stored[]> => {
    const items: Stored[] = []
    let exclusiveStartKey: Record<string, unknown> | undefined
    do {
      const hasPrefix = prefix !== undefined
      const result = await client.send(
        new QueryCommand({
          TableName: name(),
          KeyConditionExpression: hasPrefix
            ? "#pk = :pk AND begins_with(#sk, :sk)"
            : "#pk = :pk",
          ...(hasPrefix
            ? {
                ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
                ExpressionAttributeValues: { ":pk": pk, ":sk": prefix },
              }
            : {
                ExpressionAttributeNames: { "#pk": "pk" },
                ExpressionAttributeValues: { ":pk": pk },
              }),
          ExclusiveStartKey: exclusiveStartKey,
          Limit: QUERY_PAGE_LIMIT,
        })
      )
      items.push(...((result.Items ?? []) as Stored[]))
      exclusiveStartKey = result.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined
    } while (exclusiveStartKey !== undefined)
    return items
  }

  const queryGsi1 = async (
    gsi1pk: string,
    beginsWith?: string
  ): Promise<Stored[]> => {
    const hasPrefix = beginsWith !== undefined
    const result = await client.send(
      new QueryCommand({
        TableName: name(),
        IndexName: TABLE_INDEXES.gsi1,
        KeyConditionExpression: hasPrefix
          ? "#gpk = :gpk AND begins_with(#gsk, :gsk)"
          : "#gpk = :gpk",
        ...(hasPrefix
          ? {
              ExpressionAttributeNames: { "#gpk": "gsi1pk", "#gsk": "gsi1sk" },
              ExpressionAttributeValues: { ":gpk": gsi1pk, ":gsk": beginsWith },
            }
          : {
              ExpressionAttributeNames: { "#gpk": "gsi1pk" },
              ExpressionAttributeValues: { ":gpk": gsi1pk },
            }),
      })
    )
    return (result.Items ?? []) as Stored[]
  }

  const asVisits = (items: Stored[]): Visit[] =>
    items.map((i) => i as unknown as Visit)
  const sortDesc = <T>(items: T[], by: (item: T) => string): T[] =>
    [...items].sort((a, b) => (by(a) < by(b) ? 1 : by(a) > by(b) ? -1 : 0))

  return {
    visits: {
      async put(visit) {
        await putItem(visitKeys(visit), visit, visitGsi1(visit))
      },
      async get(clientId, visitId) {
        const items = await queryBySkPrefix(`CLIENT#${clientId}`, "VISIT#")
        const found = items.find((i) => i.id === visitId)
        return found === undefined ? null : (found as unknown as Visit)
      },
      async byClient(clientId) {
        const items = await queryBySkPrefix(`CLIENT#${clientId}`, "VISIT#")
        return sortDesc(asVisits(items), (v) => visitKeys(v).sk)
      },
      async byAgencyAndDate(agencyId, date) {
        const items = await queryGsi1(`AGENCY#${agencyId}`, `DATE#${date}#`)
        return asVisits(items).sort((a, b) =>
          visitGsi1(a).gsi1sk < visitGsi1(b).gsi1sk ? -1 : 1
        )
      },
    },

    events: {
      async put(event) {
        try {
          await putItem(
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
      async byClient(clientId, options) {
        const items = (await queryBySkPrefix(
          `CLIENT#${clientId}`,
          "EVENT#"
        )) as unknown as DoorEvent[]
        const filtered = items
          .filter(
            (e) => options?.sinceMs === undefined || e.timestampMs >= options.sinceMs
          )
          .sort((a, b) => a.timestampMs - b.timestampMs)
        const limit = options?.limit
        return limit === undefined ? filtered : filtered.slice(0, limit)
      },
    },

    exceptions: {
      async put(exception) {
        await putItem(exceptionKeys(exception), exception, exceptionGsi1(exception))
      },
      async get(agencyId, exceptionId) {
        const items = await queryBySkPrefix(`AGENCY#${agencyId}`, "EXC#")
        const found = items.find((i) => i.id === exceptionId)
        return found === undefined ? null : (found as unknown as Exception)
      },
      async byAgency(agencyId, state) {
        const items = (await queryBySkPrefix(
          `AGENCY#${agencyId}`,
          "EXC#"
        )) as unknown as Exception[]
        return sortDesc(
          items.filter((e) => state === undefined || e.state === state),
          (e) => exceptionGsi1(e).gsi1sk
        )
      },
    },

    caregivers: {
      async put(caregiver) {
        await putItem(caregiverKeys(caregiver), caregiver)
      },
      async get(agencyId, caregiverId) {
        const item = await getItem(caregiverKeys({ agencyId, id: caregiverId }))
        return item === undefined ? null : (item as unknown as Caregiver)
      },
      async byAgency(agencyId) {
        const items = await queryBySkPrefix(`AGENCY#${agencyId}`, "CAREGIVER#")
        return items as unknown as Caregiver[]
      },
    },

    clients: {
      async put(client) {
        await putItem(clientKeys(client), client)
      },
      async get(agencyId, clientId) {
        const item = await getItem(clientKeys({ agencyId, id: clientId }))
        return item === undefined ? null : (item as unknown as Client)
      },
      async byAgency(agencyId) {
        const items = await queryBySkPrefix(`AGENCY#${agencyId}`, "CLIENT#")
        return items as unknown as Client[]
      },
      async saveConsent(agencyId, clientId, consent, now) {
        const key = clientKeys({ agencyId, id: clientId })
        const client = await getItem(key)
        if (client === undefined) {
          throw new MalformedDataError(`client not found: ${clientId}`)
        }
        const updated: Client = {
          ...(client as unknown as Client),
          consent,
          updatedAt: now.toISOString(),
          version: (client.version as number) + 1,
        }
        await putItem(key, updated)
        return updated
      },
    },

    ringLinks: {
      async link(clientId, accountId) {
        await putItem(ringAccountKeys(accountId), { clientId })
      },
      async unlink(accountId) {
        await deleteItem(ringAccountKeys(accountId))
      },
      async clientIdFor(accountId) {
        const item = await getItem(ringAccountKeys(accountId))
        const clientId = (item as { clientId?: Id } | undefined)?.clientId
        return clientId ?? null
      },
    },

    evvRecords: {
      async put(record) {
        await putItem(evvKeys(record), record)
      },
      async get(clientId, recordId) {
        const items = await queryBySkPrefix(`CLIENT#${clientId}`, "EVV#")
        const found = items.find((i) => i.id === recordId)
        return found === undefined ? null : (found as unknown as EVVRecord)
      },
      async byClient(clientId) {
        const items = await queryBySkPrefix(`CLIENT#${clientId}`, "EVV#")
        return items as unknown as EVVRecord[]
      },
    },

    evidence: {
      async putNote(note) {
        await putItem(noteKeys(note), note)
      },
      async notesByVisit(visitId) {
        const items = await queryBySkPrefix(`VISIT#${visitId}`, "NOTE#")
        return sortDesc(items as unknown as Note[], (n) => n.at)
      },
      async putSnapshot(snapshot) {
        await putItem(snapshotKeys(snapshot), snapshot)
      },
      async snapshotsByVisit(visitId) {
        const items = await queryBySkPrefix(`VISIT#${visitId}`, "SNAP#")
        return sortDesc(items as unknown as Snapshot[], (s) => s.at)
      },
      async appendLedger(record) {
        await putItem(ledgerKeys(record), record, {}, "attribute_not_exists(#pk)")
      },
      async ledgerByClient(clientId) {
        const items = await queryBySkPrefix(`CLIENT#${clientId}`, "LEDGER#")
        return (items as unknown as LedgerRecord[]).sort((a, b) => a.seq - b.seq)
      },
    },

    webhookReceipts: {
      async claim(requestId, now) {
        try {
          await putItem(
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
