/**
 * Declarative table schema for the infra stack (docs/build.md Section 4 and
 * Section 7 DataStack). Pure data, no CDK imports, so both `infra/` and tests
 * can consume it; the CDK stack turns this into a `Table` construct.
 */

export const KEY_TYPE = { string: "S", number: "N" } as const

export interface TableKeyDefinition {
  readonly name: string
  readonly type: (typeof KEY_TYPE)[keyof typeof KEY_TYPE]
}

export interface GsiDefinition {
  readonly indexName: string
  readonly partitionKey: TableKeyDefinition
  readonly sortKey: TableKeyDefinition
}

export interface TableDefinition {
  readonly tableName: string
  readonly partitionKey: TableKeyDefinition
  readonly sortKey: TableKeyDefinition
  readonly globalSecondaryIndexes: readonly GsiDefinition[]
  readonly ttlAttribute: string
  readonly billingMode: "PAY_PER_REQUEST"
  readonly pointInTimeRecovery: true
  readonly streamEnabled: true
  readonly streamViewType: "NEW_AND_OLD_IMAGES"
}

/** The single `visitproof` table (on-demand, streams, TTL, PITR). */
export const visitproofTable: TableDefinition = Object.freeze({
  tableName: "visitproof",
  partitionKey: { name: "pk", type: KEY_TYPE.string },
  sortKey: { name: "sk", type: KEY_TYPE.string },
  globalSecondaryIndexes: Object.freeze([
    Object.freeze({
      indexName: "gsi1",
      partitionKey: { name: "gsi1pk", type: KEY_TYPE.string },
      sortKey: { name: "gsi1sk", type: KEY_TYPE.string },
    }),
    Object.freeze({
      indexName: "gsi2",
      partitionKey: { name: "gsi2pk", type: KEY_TYPE.string },
      sortKey: { name: "gsi2sk", type: KEY_TYPE.string },
    }),
  ]),
  ttlAttribute: "expiresAt",
  billingMode: "PAY_PER_REQUEST",
  pointInTimeRecovery: true,
  streamEnabled: true,
  streamViewType: "NEW_AND_OLD_IMAGES",
})

/** Webhook receipts expire after 30 days (docs/build.md Section 4). */
export const WEBHOOK_RECEIPT_TTL_SECONDS = 30 * 24 * 60 * 60
