import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from "@aws-sdk/client-dynamodb"
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  type TranslateConfig,
} from "@aws-sdk/lib-dynamodb"

import { TABLE_INDEXES, type DbConfig } from "../config"
import { DbError } from "../errors"
import type { Key } from "../keys"

/** A stored item: the entity attributes plus its key columns. */
export type Stored = Record<string, unknown> & {
  readonly pk: string
  readonly sk: string
}

/**
 * Marshalling options for the document client. Domain builders legitimately
 * emit `undefined` for absent optional fields (for example
 * `reconciliation.clockOut` before a clock-out exists); without
 * `removeUndefinedValues` the SDK's marshall throws on every such write.
 */
export const DOCUMENT_TRANSLATE_CONFIG: Readonly<TranslateConfig> =
  Object.freeze({
    marshallOptions: {
      removeUndefinedValues: true,
      convertClassInstanceToMap: false,
    },
    unmarshallOptions: { wrapNumbers: false },
  })

/**
 * A fresh copy per client: lib-dynamodb writes defaults into the options
 * objects it is given, so a shared frozen object would throw.
 */
const translateConfig = (): TranslateConfig => ({
  marshallOptions: { ...DOCUMENT_TRANSLATE_CONFIG.marshallOptions },
  unmarshallOptions: { ...DOCUMENT_TRANSLATE_CONFIG.unmarshallOptions },
})

/** The production document client over the configured region and endpoint. */
export const createDocumentClient = (
  config: Pick<DbConfig, "region" | "endpoint">,
  clientConfig: DynamoDBClientConfig = {}
): DynamoDBDocumentClient =>
  DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: config.region,
      ...(config.endpoint !== undefined ? { endpoint: config.endpoint } : {}),
      ...clientConfig,
    }),
    translateConfig()
  )

const QUERY_PAGE_LIMIT = 200
const BATCH_WRITE_LIMIT = 25
const BATCH_WRITE_MAX_ATTEMPTS = 5

export interface TableClient {
  putItem(
    key: Key,
    item: Record<string, unknown>,
    extra?: Record<string, unknown>,
    condition?: string
  ): Promise<void>
  getItem(key: Key): Promise<Stored | undefined>
  deleteItem(key: Key): Promise<void>
  deleteKeys(keys: readonly Key[]): Promise<number>
  queryBySkPrefix(pk: string, prefix?: string): Promise<Stored[]>
  queryGsi1(gsi1pk: string, beginsWith?: string): Promise<Stored[]>
}

interface KeyNames {
  /** Attribute names of the partition and sort key. */
  readonly pk: string
  readonly sk: string
  /** Expression tokens (without the `#` / `:` sigils). */
  readonly pkToken: string
  readonly skToken: string
}

const TABLE_KEY_NAMES: KeyNames = {
  pk: "pk",
  sk: "sk",
  pkToken: "pk",
  skToken: "sk",
}
const GSI1_KEY_NAMES: KeyNames = {
  pk: "gsi1pk",
  sk: "gsi1sk",
  pkToken: "gpk",
  skToken: "gsk",
}

const keyCondition = (
  names: KeyNames,
  pk: string,
  prefix: string | undefined
): {
  KeyConditionExpression: string
  ExpressionAttributeNames: Record<string, string>
  ExpressionAttributeValues: Record<string, unknown>
} => {
  const pkName = `#${names.pkToken}`
  const pkValue = `:${names.pkToken}`
  if (prefix === undefined) {
    return {
      KeyConditionExpression: `${pkName} = ${pkValue}`,
      ExpressionAttributeNames: { [pkName]: names.pk },
      ExpressionAttributeValues: { [pkValue]: pk },
    }
  }
  const skName = `#${names.skToken}`
  const skValue = `:${names.skToken}`
  return {
    KeyConditionExpression: `${pkName} = ${pkValue} AND begins_with(${skName}, ${skValue})`,
    ExpressionAttributeNames: { [pkName]: names.pk, [skName]: names.sk },
    ExpressionAttributeValues: { [pkValue]: pk, [skValue]: prefix },
  }
}

/** Low-level single-table operations shared by the entity repository. */
export const createTableClient = (
  client: DynamoDBDocumentClient,
  tableName: string
): TableClient => {
  const query = async (
    names: KeyNames,
    pk: string,
    prefix: string | undefined,
    indexName?: string
  ): Promise<Stored[]> => {
    const items: Stored[] = []
    let exclusiveStartKey: Record<string, unknown> | undefined
    do {
      const result = await client.send(
        new QueryCommand({
          TableName: tableName,
          ...(indexName !== undefined ? { IndexName: indexName } : {}),
          ...keyCondition(names, pk, prefix),
          ExclusiveStartKey: exclusiveStartKey,
          Limit: QUERY_PAGE_LIMIT,
        })
      )
      items.push(...((result.Items ?? []) as Stored[]))
      exclusiveStartKey = result.LastEvaluatedKey as
        Record<string, unknown> | undefined
    } while (exclusiveStartKey !== undefined)
    return items
  }

  const writeDeleteBatch = async (batch: readonly Key[]): Promise<void> => {
    let pending: Record<string, unknown>[] = batch.map((key) => ({
      DeleteRequest: { Key: { pk: key.pk, sk: key.sk } },
    }))
    for (let attempt = 1; pending.length > 0; attempt += 1) {
      if (attempt > BATCH_WRITE_MAX_ATTEMPTS) {
        throw new DbError(
          `batch delete left ${pending.length} unprocessed items`
        )
      }
      const result = await client.send(
        new BatchWriteCommand({ RequestItems: { [tableName]: pending } })
      )
      pending = (result.UnprocessedItems?.[tableName] ?? []) as Record<
        string,
        unknown
      >[]
    }
  }

  return {
    async putItem(key, item, extra = {}, condition) {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: { ...item, ...extra, pk: key.pk, sk: key.sk },
          // A ConditionExpression referencing #pk without the names map is a
          // ValidationException in production: always pair them.
          ...(condition !== undefined
            ? {
                ConditionExpression: condition,
                ExpressionAttributeNames: { "#pk": "pk" },
              }
            : {}),
        })
      )
    },
    async getItem(key) {
      const result = await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: key.pk, sk: key.sk },
        })
      )
      return result.Item as Stored | undefined
    },
    async deleteItem(key) {
      await client.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { pk: key.pk, sk: key.sk },
        })
      )
    },
    async deleteKeys(keys) {
      for (let start = 0; start < keys.length; start += BATCH_WRITE_LIMIT) {
        await writeDeleteBatch(keys.slice(start, start + BATCH_WRITE_LIMIT))
      }
      return keys.length
    },
    queryBySkPrefix: (pk, prefix) => query(TABLE_KEY_NAMES, pk, prefix),
    queryGsi1: (gsi1pk, beginsWith) =>
      query(GSI1_KEY_NAMES, gsi1pk, beginsWith, TABLE_INDEXES.gsi1),
  }
}
