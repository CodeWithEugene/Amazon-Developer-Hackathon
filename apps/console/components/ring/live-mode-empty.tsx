import Link from "next/link"
import { PlugZapIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

/** Demo mode without a Ring token: explain how to turn live mode on. */
export function LiveModeEmpty({ feature }: { feature: string }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PlugZapIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>Live Mode Is Off</EmptyTitle>
        <EmptyDescription>
          {feature} calls the Ring Partner API, and this server has no Ring token yet, so the offline demo shows
          nothing here.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <p className="text-sm text-muted-foreground">
          To turn it on, mint a 30 minute token in the Ring Developer Playground, set RING_PLAYGROUND_ACCESS_TOKEN
          on the server, and restart the console. A family that links Ring from the Ring app turns it on for their
          own home.
        </p>
        <Button variant="outline" render={<Link href="/family" />} nativeButton={false}>
          Back To Home
        </Button>
      </EmptyContent>
    </Empty>
  )
}
