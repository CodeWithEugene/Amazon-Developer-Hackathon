import { App, Tags } from "aws-cdk-lib"

import { VisitProofStack } from "../lib/visitproof-stack"

const app = new App()

const environment = app.node.tryGetContext("environment") ?? "dev"

new VisitProofStack(app, `VisitProof-${environment}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
})

Tags.of(app).add("Project", "visitproof")
