import type { Metadata } from "next"
import Link from "next/link"
import { LogInIcon, MessageCircleQuestionIcon, ServerOffIcon } from "lucide-react"

import { askConfigFromEnv } from "@visitproof/copilot"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { AskSimulator } from "@/components/ask/ask-simulator"
import { PageShell } from "@/components/page-shell"
import { getSessionRole } from "@/lib/session"
import { ASK_HOSTED_UNAVAILABLE, isHostedDemo } from "@/lib/store/hosted"

export const metadata: Metadata = {
  title: "Ask VisitProof",
  description: "A simulated Alexa+ experience. Every answer is a tool call on the VisitProof MCP server.",
}

export default async function AskPage() {
  const role = await getSessionRole()
  const persona = role === "family" ? "family" : role === "scheduler" || role === "compliance" ? "agency" : null
  const config = askConfigFromEnv(process.env)
  return (
    <PageShell
      role={role}
      title="Ask VisitProof"
      description="Ask by voice or text, the way you would on an Echo Show. Answers come from the VisitProof MCP server."
    >
      {persona && isHostedDemo() ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ServerOffIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Ask VisitProof Runs Locally</EmptyTitle>
            <EmptyDescription>{ASK_HOSTED_UNAVAILABLE}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : persona ? (
        <AskSimulator persona={persona} brain={config.modelProvider} mcpUrl={config.mcpUrl} />
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageCircleQuestionIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Sign In To Ask VisitProof</EmptyTitle>
            <EmptyDescription>
              Ask VisitProof answers for a family member or for agency staff. Sign in as one of them to start.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button render={<Link href="/" />} nativeButton={false}>
              <LogInIcon data-icon="inline-start" aria-hidden="true" />
              Choose A Role
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </PageShell>
  )
}
