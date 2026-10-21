import { Stack, type StackProps } from "aws-cdk-lib"
import { CfnBudget } from "aws-cdk-lib/aws-budgets"
import { Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam"
import { Topic } from "aws-cdk-lib/aws-sns"
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions"
import type { Construct } from "constructs"

export interface ObservabilityStackProps extends StackProps {
  budgetLimitUsd: number
  alertEmail?: string
}

/** Budget thresholds from docs/research.md Section 6.2 ($50 and $100). */
export const BUDGET_THRESHOLDS_PERCENT = Object.freeze([50, 100])

/**
 * Alerts topic (budget notifications and CloudWatch alarms) plus a monthly
 * AWS Budgets cost budget with alerts at 50 percent and 100 percent of the
 * limit (50 USD and 100 USD at the default 100 USD limit).
 */
export class ObservabilityStack extends Stack {
  readonly alertsTopic: Topic

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props)
    this.alertsTopic = new Topic(this, "AlertsTopic", {
      displayName: "VisitProof Alerts",
      enforceSSL: true,
    })
    this.alertsTopic.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal("budgets.amazonaws.com")],
        actions: ["sns:Publish"],
        resources: [this.alertsTopic.topicArn],
        conditions: { StringEquals: { "aws:SourceAccount": this.account } },
      })
    )
    if (props.alertEmail !== undefined) {
      this.alertsTopic.addSubscription(new EmailSubscription(props.alertEmail))
    }

    new CfnBudget(this, "MonthlyCostBudget", {
      budget: {
        budgetName: "visitproof-monthly",
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: props.budgetLimitUsd, unit: "USD" },
      },
      notificationsWithSubscribers: BUDGET_THRESHOLDS_PERCENT.map(
        (threshold) => ({
          notification: {
            notificationType: "ACTUAL",
            comparisonOperator: "GREATER_THAN",
            threshold,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [
            { subscriptionType: "SNS", address: this.alertsTopic.topicArn },
          ],
        })
      ),
    })
  }
}
