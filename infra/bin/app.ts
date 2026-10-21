import { App } from "aws-cdk-lib"

import { readInfraConfig } from "../lib/config"
import { createVisitProofStacks } from "../lib/stacks"

/**
 * CDK entry. Synthesizes offline: no context lookups, no account lookups
 * (stacks are account-agnostic), and no credentials are read by this code.
 */
const app = new App()
const config = readInfraConfig((key) => app.node.tryGetContext(key))

createVisitProofStacks(app, config)
