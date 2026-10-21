import { Duration, Stack, type StackProps } from "aws-cdk-lib"
import {
  StartingPosition,
  FilterCriteria,
  FilterRule,
} from "aws-cdk-lib/aws-lambda"
import type { ITable } from "aws-cdk-lib/aws-dynamodb"
import { Rule, Schedule } from "aws-cdk-lib/aws-events"
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets"
import { PolicyStatement } from "aws-cdk-lib/aws-iam"
import type { IKey } from "aws-cdk-lib/aws-kms"
import { DynamoEventSource, SqsDlq } from "aws-cdk-lib/aws-lambda-event-sources"
import type { Function as LambdaFn } from "aws-cdk-lib/aws-lambda"
import type { IBucket } from "aws-cdk-lib/aws-s3"
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs"
import type { Construct } from "constructs"

import type { InfraConfig } from "./config"
import { visitProofFunction } from "./lambda"
import { grantTableActions, TABLE_READ, TABLE_READ_WRITE } from "./table-access"

export interface EngineStackProps extends StackProps {
  table: ITable
  mediaBucket: IBucket
  ledgerSigningKey: IKey
  config: InfraConfig
}

/** 19:00 America/New_York during daylight time (the demo agency zone). */
const DIGEST_SCHEDULE = Schedule.cron({ minute: "0", hour: "23" })

/**
 * EngineStack: the Presence Engine runtime.
 * - event processor on the table stream (INSERTs of door events only),
 *   ReportBatchItemFailures, bisect on error, on-failure DLQ;
 * - visit sweeper every minute (sweep, snapshot fetch, narratives);
 * - daily digest over SES.
 * Each function gets only the actions its code performs.
 */
export class EngineStack extends Stack {
  readonly eventProcessor: LambdaFn
  readonly visitSweeper: LambdaFn
  readonly dailyDigest: LambdaFn

  constructor(scope: Construct, id: string, props: EngineStackProps) {
    super(scope, id, props)
    const { config, table } = props
    const common = {
      VISITPROOF_MODE: "live",
      VISITPROOF_STORE: "dynamodb",
      DYNAMODB_TABLE: table.tableName,
      VISITPROOF_AGENCY_ID: config.agencyId,
      // Live mode refuses the local HMAC signer, so the key id is always set.
      KMS_SIGNING_KEY_ID: props.ledgerSigningKey.keyArn,
    }

    this.eventProcessor = visitProofFunction(this, "EventProcessor", {
      entry: "apps/engine/src/lambda/event-processor.ts",
      description: "Presence Engine: door events from the table stream",
      timeout: Duration.seconds(30),
      environment: common,
    })
    grantTableActions(this.eventProcessor, table, TABLE_READ_WRITE)
    // The engine appends signed ledger records as it decides (EARS rule 10).
    props.ledgerSigningKey.grant(this.eventProcessor, "kms:Sign")
    this.addStreamSource(table)

    this.visitSweeper = visitProofFunction(this, "VisitSweeper", {
      entry: "apps/engine/src/lambda/visit-sweeper.ts",
      description:
        "Presence Engine sweep, snapshot fetch, and narratives (every minute)",
      timeout: Duration.seconds(60),
      environment: {
        ...common,
        MODEL_PROVIDER: config.modelProvider,
        BEDROCK_MODEL_ID: config.bedrockModelId,
        S3_SNAPSHOT_BUCKET: props.mediaBucket.bucketName,
        ...(config.bedrockGuardrailId && config.bedrockGuardrailVersion
          ? {
              BEDROCK_GUARDRAIL_ID: config.bedrockGuardrailId,
              BEDROCK_GUARDRAIL_VERSION: config.bedrockGuardrailVersion,
            }
          : {}),
      },
    })
    grantTableActions(this.visitSweeper, table, TABLE_READ_WRITE)
    props.ledgerSigningKey.grant(this.visitSweeper, "kms:Sign")
    this.grantBedrock(this.visitSweeper, config)
    this.visitSweeper.addToRolePolicy(
      new PolicyStatement({
        actions: ["s3:PutObject", "s3:PutObjectTagging"],
        resources: [props.mediaBucket.arnForObjects("snapshots/*")],
      })
    )
    new Rule(this, "SweepEveryMinute", {
      schedule: Schedule.rate(Duration.minutes(1)),
      targets: [new LambdaFunction(this.visitSweeper, { retryAttempts: 0 })],
    })

    this.dailyDigest = visitProofFunction(this, "DailyDigest", {
      entry: "apps/engine/src/lambda/daily-digest.ts",
      description: "Daily family digest and exception alerts over SES",
      timeout: Duration.seconds(60),
      environment: {
        ...common,
        ...(config.sesFromAddress
          ? { SES_FROM_ADDRESS: config.sesFromAddress }
          : {}),
        ...(config.sesAllowedRecipients
          ? { SES_ALLOWED_RECIPIENTS: config.sesAllowedRecipients }
          : {}),
      },
    })
    grantTableActions(this.dailyDigest, table, TABLE_READ)
    if (config.sesFromAddress) {
      this.dailyDigest.addToRolePolicy(
        new PolicyStatement({
          actions: ["ses:SendEmail"],
          resources: [
            this.formatArn({
              service: "ses",
              resource: "identity",
              resourceName: "*",
            }),
          ],
          conditions: {
            StringEquals: { "ses:FromAddress": config.sesFromAddress },
          },
        })
      )
    }
    new Rule(this, "DailyDigestSchedule", {
      schedule: DIGEST_SCHEDULE,
      targets: [new LambdaFunction(this.dailyDigest, { retryAttempts: 2 })],
    })
  }

  private addStreamSource(table: ITable): void {
    const failures = new Queue(this, "EventProcessorDlq", {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    })
    this.eventProcessor.addEventSource(
      new DynamoEventSource(table, {
        startingPosition: StartingPosition.TRIM_HORIZON,
        batchSize: 25,
        reportBatchItemFailures: true,
        bisectBatchOnError: true,
        retryAttempts: 5,
        maxRecordAge: Duration.days(1),
        onFailure: new SqsDlq(failures),
        filters: [
          FilterCriteria.filter({
            eventName: FilterRule.isEqual("INSERT"),
            dynamodb: {
              NewImage: { sk: { S: FilterRule.beginsWith("EVENT#") } },
            },
          }),
        ],
      })
    )
  }

  /** Converse on the configured model (a global inference profile) only. */
  private grantBedrock(fn: LambdaFn, config: InfraConfig): void {
    if (config.modelProvider !== "bedrock") return
    const modelId = config.bedrockModelId
    const foundationModel = modelId.replace(/^(global|us|eu|apac)\./, "")
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          this.formatArn({
            service: "bedrock",
            resource: "inference-profile",
            resourceName: modelId,
          }),
          `arn:aws:bedrock:*::foundation-model/${foundationModel}`,
        ],
      })
    )
    if (config.bedrockGuardrailId) {
      fn.addToRolePolicy(
        new PolicyStatement({
          actions: ["bedrock:ApplyGuardrail"],
          resources: [
            this.formatArn({
              service: "bedrock",
              resource: "guardrail",
              resourceName: config.bedrockGuardrailId,
            }),
          ],
        })
      )
    }
  }
}
