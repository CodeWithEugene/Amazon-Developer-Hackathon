import Link from "next/link"
import { LinkIcon, TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"

import { PageShell } from "@/components/page-shell"
import { checkLinkRequest, type LinkCheck } from "@/lib/ring/account-link"
import { getTokenStore, ringEnv } from "@/lib/ring/live"

export const metadata = { title: "Link Ring" }

const FAILURES: Readonly<Record<Extract<LinkCheck, { ok: false }>["reason"], string>> = {
  invalid: "This page needs the link Ring opens after you tap Confirm in the Ring app.",
  stale: "This link from the Ring app is more than 10 minutes old. Open VisitProof from Ring My Apps to get a fresh one.",
  future: "This link from the Ring app has a time in the future. Check the device clock and try again from the Ring app.",
  no_match: "VisitProof could not match this link to a Ring account waiting to be linked. Install VisitProof from the Ring Appstore again.",
  misconfigured: "Ring linking is not configured on this server yet.",
}

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value)

/** Ring Account Link URL: freshness, nonce match, then passwordless sign in. */
export default async function LinkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const query = { nonce: first(params.nonce), time: first(params.time) }
  const check = await checkLinkRequest(query, {
    store: getTokenStore(),
    hmacKey: ringEnv().RING_HMAC_SIGNING_KEY ?? "",
    now: Date.now,
  })
  return (
    <PageShell role={null} width="narrow" title="Link Your Ring Account">
      {check.ok ? <LinkForm nonce={check.nonce} time={check.time} email={check.unclaimed.email} /> : <LinkFailure reason={check.reason} />}
    </PageShell>
  )
}

function LinkForm({ nonce, time, email }: { nonce: string; time: number; email: string | undefined }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LinkIcon aria-hidden="true" />
          Create Your VisitProof Account
        </CardTitle>
        <CardDescription>
          No password needed. VisitProof uses the email on your Ring account. In this demo, continuing signs you in as
          the family of the demo household.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form method="post" action="/link/confirm">
          <input type="hidden" name="nonce" value={nonce} />
          <input type="hidden" name="time" value={String(time)} />
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ring-email">Ring Email</FieldLabel>
              <Input id="ring-email" name="email" type="email" autoComplete="email" defaultValue={email ?? ""} required />
              <FieldDescription>Filled in from your Ring account. You can change it.</FieldDescription>
            </Field>
            <Button type="submit">Create Account And Link Ring</Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

function LinkFailure({ reason }: { reason: Extract<LinkCheck, { ok: false }>["reason"] }) {
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="destructive">
        <TriangleAlertIcon aria-hidden="true" />
        <AlertTitle>This Link Cannot Be Used</AlertTitle>
        <AlertDescription>{FAILURES[reason]}</AlertDescription>
      </Alert>
      <Button variant="outline" render={<Link href="/ring" />} nativeButton={false}>
        See How To Link
      </Button>
    </div>
  )
}
