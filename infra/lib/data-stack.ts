import {
  SNAPSHOT_KEY_PREFIX,
  SNAPSHOT_MAX_RETENTION_DAYS,
  SNAPSHOT_RETENTION_CLASSES_DAYS,
  SNAPSHOT_RETENTION_TAG_KEY,
  visitproofTable,
} from "@visitproof/db"
import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib"
import {
  AttributeType,
  BillingMode,
  StreamViewType,
  Table,
} from "aws-cdk-lib/aws-dynamodb"
import { Key, KeySpec, KeyUsage } from "aws-cdk-lib/aws-kms"
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  ObjectOwnership,
  type LifecycleRule,
} from "aws-cdk-lib/aws-s3"
import type { Construct } from "constructs"

/** Evidence packs and EVV exports follow the agency default retention. */
const EVIDENCE_RETENTION_DAYS = 365

const snapshotLifecycle = (): LifecycleRule[] => [
  ...SNAPSHOT_RETENTION_CLASSES_DAYS.map((days) => ({
    id: `snapshots-retention-${days}d`,
    prefix: SNAPSHOT_KEY_PREFIX,
    tagFilters: { [SNAPSHOT_RETENTION_TAG_KEY]: String(days) },
    expiration: Duration.days(days),
  })),
  {
    id: "snapshots-safety-net",
    prefix: SNAPSHOT_KEY_PREFIX,
    expiration: Duration.days(SNAPSHOT_MAX_RETENTION_DAYS),
  },
  {
    id: "evidence-retention",
    prefix: "evidence/",
    expiration: Duration.days(EVIDENCE_RETENTION_DAYS),
  },
  {
    id: "evv-retention",
    prefix: "evv/",
    expiration: Duration.days(EVIDENCE_RETENTION_DAYS),
  },
  {
    id: "abort-incomplete-uploads",
    abortIncompleteMultipartUploadAfter: Duration.days(1),
  },
]

/**
 * DataStack (docs/build.md Section 7): the single DynamoDB table, the media
 * bucket, and the two KMS keys. Data resources are retained on stack delete.
 */
export class DataStack extends Stack {
  readonly table: Table
  readonly mediaBucket: Bucket
  readonly tokenKey: Key
  readonly ledgerSigningKey: Key

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)
    const def = visitproofTable
    this.table = new Table(this, "Table", {
      tableName: def.tableName,
      partitionKey: { name: def.partitionKey.name, type: AttributeType.STRING },
      sortKey: { name: def.sortKey.name, type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      timeToLiveAttribute: def.ttlAttribute,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    })
    for (const gsi of def.globalSecondaryIndexes) {
      this.table.addGlobalSecondaryIndex({
        indexName: gsi.indexName,
        partitionKey: {
          name: gsi.partitionKey.name,
          type: AttributeType.STRING,
        },
        sortKey: { name: gsi.sortKey.name, type: AttributeType.STRING },
      })
    }

    this.mediaBucket = new Bucket(this, "MediaBucket", {
      encryption: BucketEncryption.KMS_MANAGED,
      bucketKeyEnabled: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      enforceSSL: true,
      lifecycleRules: snapshotLifecycle(),
      removalPolicy: RemovalPolicy.RETAIN,
    })

    this.tokenKey = new Key(this, "TokenKey", {
      alias: "alias/visitproof-ring-tokens",
      description: "Envelope encryption for Ring OAuth tokens",
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    })

    this.ledgerSigningKey = new Key(this, "LedgerSigningKey", {
      alias: "alias/visitproof-ledger-signing",
      description: "ECDSA P-256 signing key for the evidence ledger",
      keySpec: KeySpec.ECC_NIST_P256,
      keyUsage: KeyUsage.SIGN_VERIFY,
      removalPolicy: RemovalPolicy.RETAIN,
    })
  }
}
