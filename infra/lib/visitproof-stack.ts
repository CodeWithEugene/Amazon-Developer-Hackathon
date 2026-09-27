import { Stack, type StackProps } from "aws-cdk-lib"
import type { Construct } from "constructs"

/**
 * Placeholder stack. The infra agent splits this into DataStack, AuthStack,
 * WebhookStack, EngineStack, McpStack, HostingStack, and ObservabilityStack
 * per docs/build.md Section 7.
 */
export class VisitProofStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)
  }
}
