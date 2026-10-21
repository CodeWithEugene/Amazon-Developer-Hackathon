import Link from "next/link"
import { CircleCheckIcon, LinkIcon, TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@workspace/ui/components/card"

import { PageShell } from "@/components/page-shell"
import { getTokenStore } from "@/lib/ring/live"
import { getSessionRole } from "@/lib/session"
import { AGENCY_ID, getSessionClientId, getStore } from "@/lib/store"

export const metadata = { title: "Ring Account" }

const LINK_ERRORS: Readonly<Record<string, string>> = {
  stale: "The link from the Ring app expired. Open VisitProof from Ring My Apps and try again.",
  future: "The link from the Ring app had an invalid time. Open VisitProof from Ring My Apps and try again.",
  invalid: "The link from the Ring app was incomplete. Open VisitProof from Ring My Apps and try again.",
  no_match: "VisitProof could not match this link to a Ring account. Install VisitProof from the Ring Appstore again.",
  taken: "This link was already used. Your Ring account may already be linked.",
  ring_rejected: "Ring did not confirm the link. Open VisitProof from Ring My Apps and try again.",
  misconfigured: "Ring linking is not configured on this server yet.",
}

const isLinked = async (clientId: string | undefined): Promise<boolean> => {
  if (!clientId) return false
  const [client, linked] = await Promise.all([
    getStore().clients.get(AGENCY_ID, clientId),
    getTokenStore().getLinked(clientId),
  ])
  return linked !== null || client?.ringLinkStatus === "linked"
}

/** Ring App Homepage URL: confirms the link or shows next steps. Never a dead end. */
export default async function RingHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const role = await getSessionRole()
  const linked = role === "family" && (await isLinked(await getSessionClientId()))
  const error = typeof params.error === "string" ? LINK_ERRORS[params.error] : undefined
  return (
    <PageShell role={role} width="narrow" title={linked ? "Account Linked Successfully" : "Link Your Ring"}>
      <div className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>Linking Did Not Finish</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {linked ? <LinkedCard /> : <NextStepsCard signedIn={role !== null} />}
      </div>
    </PageShell>
  )
}

function LinkedCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CircleCheckIcon aria-hidden="true" />
          Your Ring Account Is Linked
        </CardTitle>
        <CardDescription>
          VisitProof now receives door events from the devices you shared. Review what the agency can see, then run a
          quick Device Check.
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex flex-wrap gap-2">
        <Button render={<Link href="/family" />} nativeButton={false}>
          Review Consent Settings
        </Button>
        <Button variant="outline" render={<Link href="/family/devices" />} nativeButton={false}>
          Run Device Check
        </Button>
        <Button variant="outline" render={<Link href="/family/live" />} nativeButton={false}>
          Open Live View
        </Button>
      </CardFooter>
    </Card>
  )
}

function NextStepsCard({ signedIn }: { signedIn: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LinkIcon aria-hidden="true" />
          Three Steps To Link
        </CardTitle>
        <CardDescription>VisitProof is compatible with Ring cameras and doorbells.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          <li>In the Ring app, open the Ring Appstore and choose VisitProof.</li>
          <li>Review the data VisitProof asks for, pick the front door doorbell, and tap Confirm.</li>
          <li>Ring brings you back here to finish, with your Ring email already filled in.</li>
        </ol>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button render={<Link href={signedIn ? "/family" : "/"} />} nativeButton={false}>
          {signedIn ? "Go To Home" : "Sign In"}
        </Button>
        <Button variant="outline" render={<Link href="/family/devices" />} nativeButton={false}>
          Run Device Check
        </Button>
      </CardFooter>
    </Card>
  )
}
