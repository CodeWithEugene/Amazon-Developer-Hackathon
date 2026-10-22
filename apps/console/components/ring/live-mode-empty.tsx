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
          To turn it on for your home, link your Ring account from the Ring app. For a demo, the person who runs
          this console can add a 30-minute Ring Developer Playground token on the server and restart it.
        </p>
        <Button variant="outline" render={<Link href="/family" />} nativeButton={false}>
          Back To Home
        </Button>
      </EmptyContent>
    </Empty>
  )
}
