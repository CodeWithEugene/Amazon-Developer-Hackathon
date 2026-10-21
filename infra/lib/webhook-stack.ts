import {
  CfnOutput,
  CfnParameter,
  Duration,
  Stack,
  type StackProps,
} from "aws-cdk-lib"
import { HttpApi, HttpMethod, HttpStage } from "aws-cdk-lib/aws-apigatewayv2"
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations"
import {
  Alarm,
  ComparisonOperator,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch"
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions"
import type { ITable } from "aws-cdk-lib/aws-dynamodb"
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs"
import type { ITopic } from "aws-cdk-lib/aws-sns"
import type { Construct } from "constructs"

import { visitProofFunction } from "./lambda"
import { grantTableActions, TABLE_READ_WRITE } from "./table-access"

export interface WebhookStackProps extends StackProps {
  table: ITable
  alertsTopic: ITopic
  agencyId: string
}

/** Ring's delivery budget is 5 seconds (docs/research.md Section 2.7). */
const WEBHOOK_TIMEOUT = Duration.seconds(5)
const THROTTLE = Object.freeze({ rateLimit: 50, burstLimit: 100 })

/**
 * WebhookStack: the public Ring Webhook URL. HTTP API `POST /ring/webhook`
 * to the apps/webhooks Lambda (arm64, 256 MB, 5 s), a DLQ for asynchronous
 * invocations, and alarms on 5xx responses and function errors.
 */
export class WebhookStack extends Stack {
  readonly api: HttpApi

  constructor(scope: Construct, id: string, props: WebhookStackProps) {
    super(scope, id, props)
    // NoEcho parameter: never in the template or the repo. It lands in the
    // function's environment; moving it to SSM SecureString is a follow-up.
    const signingKey = new CfnParameter(this, "RingHmacSigningKey", {
      type: "String",
      noEcho: true,
      default: "",
      description: "Ring webhook HMAC signing key (Ring Developer Portal)",
    })
    const dlq = new Queue(this, "WebhookDlq", {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    })
    const receiver = visitProofFunction(this, "WebhookReceiver", {
      entry: "apps/webhooks/src/lambda.ts",
      description:
        "Ring Webhook URL receiver: verify, persist, acknowledge 202",
      timeout: WEBHOOK_TIMEOUT,
      deadLetterQueue: dlq,
      environment: {
        VISITPROOF_MODE: "live",
        DYNAMODB_TABLE: props.table.tableName,
        VISITPROOF_AGENCY_ID: props.agencyId,
        // The stream processor runs the engine in AWS (contract C5).
        VISITPROOF_ENGINE_INLINE: "false",
        RING_HMAC_SIGNING_KEY: signingKey.valueAsString,
      },
    })
    grantTableActions(receiver, props.table, TABLE_READ_WRITE)

    this.api = new HttpApi(this, "WebhookApi", {
      description: "VisitProof Ring Webhook URL",
      createDefaultStage: false,
    })
    new HttpStage(this, "DefaultStage", {
      httpApi: this.api,
      stageName: "$default",
      autoDeploy: true,
      throttle: THROTTLE,
    })
    this.api.addRoutes({
      path: "/ring/webhook",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration("RingWebhook", receiver),
    })

    new CfnOutput(this, "RingWebhookUrl", {
      description: "Paste into the Ring Developer Portal as the Webhook URL",
      value: `${this.api.apiEndpoint}/ring/webhook`,
    })

    const alarmAction = new SnsAction(props.alertsTopic)
    new Alarm(this, "Webhook5xxAlarm", {
      alarmDescription: "Ring webhook returned 5xx responses",
      metric: this.api.metricServerError({
        period: Duration.minutes(5),
        statistic: "Sum",
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alarmAction)
    new Alarm(this, "WebhookErrorsAlarm", {
      alarmDescription: "Ring webhook Lambda errors",
      metric: receiver.metricErrors({
        period: Duration.minutes(5),
        statistic: "Sum",
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alarmAction)
  }
}
