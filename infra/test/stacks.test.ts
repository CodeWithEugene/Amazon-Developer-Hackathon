import { App } from "aws-cdk-lib"
import { Match, Template } from "aws-cdk-lib/assertions"
import { describe, expect, it } from "vitest"

import { readInfraConfig, type InfraConfig } from "../lib/config"
import { createVisitProofStacks } from "../lib/stacks"

/** Skip esbuild bundling in unit tests; `cdk synth` bundles for real. */
const build = (context: Record<string, unknown> = {}) => {
  const app = new App({
    context: { "aws:cdk:bundling-stacks": [], ...context },
  })
  const config: InfraConfig = readInfraConfig((key) =>
    app.node.tryGetContext(key)
  )
  const stacks = createVisitProofStacks(app, config)
  return {
    data: Template.fromStack(stacks.data),
    observability: Template.fromStack(stacks.observability),
    webhook: Template.fromStack(stacks.webhook),
    engine: Template.fromStack(stacks.engine),
  }
}

const policyActions = (template: Template): string[] =>
  Object.values(template.findResources("AWS::IAM::Policy")).flatMap((policy) =>
    (
      policy.Properties.PolicyDocument.Statement as {
        Action: string | string[]
      }[]
    ).flatMap((statement) =>
      Array.isArray(statement.Action) ? statement.Action : [statement.Action]
    )
  )

describe("DataStack", () => {
  const { data } = build()

  it("creates the single table with GSI1, GSI2, TTL, streams, and PITR", () => {
    data.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "visitproof",
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      StreamSpecification: { StreamViewType: "NEW_AND_OLD_IMAGES" },
      TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      GlobalSecondaryIndexes: [
        Match.objectLike({ IndexName: "gsi1" }),
        Match.objectLike({ IndexName: "gsi2" }),
      ],
    })
  })

  it("creates a private, SSE-KMS media bucket with retention lifecycle rules", () => {
    data.hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          Match.objectLike({
            ServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms" },
          }),
        ],
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            Id: "snapshots-retention-7d",
            ExpirationInDays: 7,
            Prefix: "snapshots/",
            TagFilters: [{ Key: "retention-days", Value: "7" }],
          }),
          Match.objectLike({
            Id: "snapshots-safety-net",
            ExpirationInDays: 30,
          }),
        ]),
      },
    })
  })

  it("creates a rotating symmetric token key and a P-256 signing key", () => {
    data.hasResourceProperties("AWS::KMS::Key", { EnableKeyRotation: true })
    data.hasResourceProperties("AWS::KMS::Key", {
      KeySpec: "ECC_NIST_P256",
      KeyUsage: "SIGN_VERIFY",
    })
  })

  it("tags resources Project=visitproof", () => {
    data.hasResourceProperties("AWS::DynamoDB::Table", {
      Tags: Match.arrayWith([{ Key: "Project", Value: "visitproof" }]),
    })
  })
})

describe("ObservabilityStack", () => {
  it("alerts at 50 and 100 percent of a 100 USD monthly budget", () => {
    const { observability } = build({ alertEmail: "ops@visitproof.test" })
    observability.hasResourceProperties("AWS::Budgets::Budget", {
      Budget: Match.objectLike({
        BudgetLimit: { Amount: 100, Unit: "USD" },
        TimeUnit: "MONTHLY",
      }),
      NotificationsWithSubscribers: [
        Match.objectLike({ Notification: Match.objectLike({ Threshold: 50 }) }),
        Match.objectLike({
          Notification: Match.objectLike({ Threshold: 100 }),
        }),
      ],
    })
    observability.hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: "ops@visitproof.test",
    })
  })
})

describe("WebhookStack", () => {
  const { webhook } = build()

  it("routes POST /ring/webhook to an arm64, 256 MB, 5 s Lambda with a DLQ", () => {
    webhook.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /ring/webhook",
    })
    webhook.hasResourceProperties("AWS::Lambda::Function", {
      Architectures: ["arm64"],
      MemorySize: 256,
      Timeout: 5,
      Runtime: "nodejs22.x",
      DeadLetterConfig: { TargetArn: Match.anyValue() },
      Environment: {
        Variables: Match.objectLike({
          VISITPROOF_ENGINE_INLINE: "false",
          VISITPROOF_MODE: "live",
        }),
      },
    })
  })

  it("throttles the stage and alarms on 5xx", () => {
    webhook.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      DefaultRouteSettings: {
        ThrottlingRateLimit: 50,
        ThrottlingBurstLimit: 100,
      },
    })
    webhook.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "5xx",
      Namespace: "AWS/ApiGateway",
      AlarmActions: [Match.anyValue()],
    })
  })

  it("keeps the signing key out of the template", () => {
    expect(webhook.toJSON().Parameters.RingHmacSigningKey.NoEcho).toBe(true)
  })

  it("grants only item reads and puts on the table", () => {
    expect(new Set(policyActions(webhook))).toEqual(
      new Set([
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:PutItem",
        "sqs:SendMessage",
      ])
    )
  })
})

describe("EngineStack", () => {
  const { engine } = build({ sesFromAddress: "alerts@visitproof.test" })

  it("consumes door-event INSERTs from the stream with batch item failures", () => {
    engine.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      FunctionResponseTypes: ["ReportBatchItemFailures"],
      BisectBatchOnFunctionError: true,
      StartingPosition: "TRIM_HORIZON",
      DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
      FilterCriteria: {
        Filters: [{ Pattern: Match.stringLikeRegexp("EVENT#") }],
      },
    })
  })

  it("runs the sweeper every minute and the digest daily", () => {
    engine.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "rate(1 minute)",
    })
    engine.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "cron(0 23 * * ? *)",
    })
  })

  it("scopes Bedrock to the configured model and SES to the verified sender", () => {
    engine.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "bedrock:InvokeModel",
            Resource: Match.arrayWith([
              "arn:aws:bedrock:*::foundation-model/amazon.nova-2-lite-v1:0",
            ]),
          }),
        ]),
      },
    })
    engine.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "ses:SendEmail",
            Condition: {
              StringEquals: { "ses:FromAddress": "alerts@visitproof.test" },
            },
          }),
        ]),
      },
    })
  })

  it("grants no wildcard actions, no Scan, and no deletes", () => {
    const actions = policyActions(engine)
    expect(actions.some((action) => action.endsWith(":*"))).toBe(false)
    expect(actions).not.toContain("dynamodb:Scan")
    expect(actions).not.toContain("dynamodb:DeleteItem")
  })

  it("lets only the event processor and the sweeper sign ledger records", () => {
    const signers = Object.entries(engine.findResources("AWS::IAM::Policy")).filter(([, policy]) =>
      JSON.stringify(policy).includes('"kms:Sign"')
    )
    expect(signers.map(([id]) => id).sort()).toEqual(
      expect.arrayContaining([expect.stringMatching(/^EventProcessor/), expect.stringMatching(/^VisitSweeper/)])
    )
    expect(signers).toHaveLength(2)
  })

  it("omits the SES grant when no verified sender is configured", () => {
    const { engine: withoutSes } = build()
    expect(policyActions(withoutSes)).not.toContain("ses:SendEmail")
  })
})

describe("infra config", () => {
  it("rejects an invalid alert email", () => {
    expect(() => build({ alertEmail: "not-an-email" })).toThrow()
  })
})

describe("Lambda bundles", () => {
  it("gives every engine function its own code asset", () => {
    const { engine } = build()
    const functions = Object.values(
      engine.findResources("AWS::Lambda::Function")
    )
    const keys = functions.map((fn) => JSON.stringify(fn.Properties.Code))
    expect(functions).toHaveLength(3)
    expect(new Set(keys).size).toBe(3)
  })
})
