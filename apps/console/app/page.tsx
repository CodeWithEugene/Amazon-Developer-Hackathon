import Link from "next/link"
import { CircleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Separator } from "@workspace/ui/components/separator"

import { HonestBoundaries } from "@/components/honest-boundaries"
import { SiteFooter } from "@/components/page-shell"
import { RoleSwitcher } from "@/components/role-switcher"
import { getSessionRole } from "@/lib/session"

const STEPS = [
  {
    title: "Observed",
    body: "A doorbell press or person motion at the client's door, matched to the scheduled visit window.",
  },
  {
    title: "Reported",
    body: "The caregiver's EVV clock-in and any notes from the caregiver or family, kept side by side.",
  },
  {
    title: "Resolved",
    body: "The agency's decision, signed into a hash-chained ledger. No column ever overwrites another.",
  },
] as const

const ERRORS: Record<string, string> = {
  "no-client": "The demo store has no client for the family view yet. Run pnpm demo, then sign in again.",
  "no-caregiver": "The demo store has no caregiver yet. Run pnpm demo, then sign in again.",
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const role = await getSessionRole()
  const error = (await searchParams).error
  const message = typeof error === "string" ? ERRORS[error] : undefined
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-10">
        <div className="flex flex-col gap-2">
          <h1 className="scroll-m-20 text-4xl font-semibold tracking-tight">VisitProof</h1>
          <p className="text-lg text-muted-foreground">
            Proof of presence for home care, from the doorbell already at the door.
          </p>
        </div>
        {message ? (
          <Alert variant="warning">
            <CircleAlertIcon aria-hidden="true" />
            <AlertTitle>Demo Data Needed</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}
        <section className="flex flex-col gap-4">
          <h2 className="scroll-m-20 text-2xl font-semibold tracking-tight">How It Works</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {STEPS.map((step) => (
              <Card key={step.title} size="sm">
                <CardHeader>
                  <CardTitle>{step.title}</CardTitle>
                  <CardDescription>{step.body}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
          <HonestBoundaries detail="It is not an EVV system of record, not identity verification, not resident monitoring, and not a medical device." />
        </section>
        <Separator />
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="scroll-m-20 text-2xl font-semibold tracking-tight">See The Demo</h2>
            <p className="text-muted-foreground">
              Choose a role to sign in with one click. This is a demo sign-in
              over local demo data only; no account is needed. Read the{" "}
              <Link href="/privacy" className="underline underline-offset-4">
                privacy policy
              </Link>
              .
            </p>
          </div>
          <RoleSwitcher current={role} />
        </section>
        <Card size="sm">
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Events in the demo are emulated and labeled &quot;Emulated Event (Demo)&quot;.
              Live Ring events are labeled with their source.
            </p>
          </CardContent>
        </Card>
      </main>
      <SiteFooter />
    </div>
  )
}
