import { Tags, type App } from "aws-cdk-lib"

import { PROJECT_TAG, type InfraConfig } from "./config"
import { DataStack } from "./data-stack"
import { EngineStack } from "./engine-stack"
import { ObservabilityStack } from "./observability-stack"
import { WebhookStack } from "./webhook-stack"

export interface VisitProofStacks {
  data: DataStack
  observability: ObservabilityStack
  webhook: WebhookStack
  engine: EngineStack
}

/** Every stack VisitProof deploys today, wired together and tagged Project=visitproof. */
export function createVisitProofStacks(
  app: App,
  config: InfraConfig
): VisitProofStacks {
  const env = { region: config.region }
  const prefix = `VisitProof-${config.environment}`
  const data = new DataStack(app, `${prefix}-Data`, { env })
  const observability = new ObservabilityStack(app, `${prefix}-Observability`, {
    env,
    budgetLimitUsd: config.budgetLimitUsd,
    ...(config.alertEmail ? { alertEmail: config.alertEmail } : {}),
  })
  const webhook = new WebhookStack(app, `${prefix}-Webhook`, {
    env,
    table: data.table,
    alertsTopic: observability.alertsTopic,
    agencyId: config.agencyId,
  })
  const engine = new EngineStack(app, `${prefix}-Engine`, {
    env,
    table: data.table,
    mediaBucket: data.mediaBucket,
    ledgerSigningKey: data.ledgerSigningKey,
    config,
  })
  Tags.of(app).add(PROJECT_TAG.key, PROJECT_TAG.value)
  return { data, observability, webhook, engine }
}
