"use client"

import Link from "next/link"
import { useEffect } from "react"
import { CircleAlertIcon, RotateCcwIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

/** Error boundary body with a retry, shared by every route group. */
export function RouteError({
  error,
  retry,
  area,
}: {
  error: Error & { digest?: string }
  retry: () => void
  area: string
}) {
  useEffect(() => {
    console.error(`[${area}] render failed`, error)
  }, [area, error])
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl items-center px-4 py-10">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleAlertIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>This Page Could Not Load</EmptyTitle>
          <EmptyDescription>
            Something went wrong while reading the {area} data. Try again, and if
            it keeps happening, check that the demo store exists (run pnpm demo).
            {error.digest ? ` Reference ${error.digest}.` : ""}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center gap-2">
          <Button onClick={() => retry()}>
            <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
            Try Again
          </Button>
          <Button variant="outline" render={<Link href="/" />} nativeButton={false}>
            Go Home
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  )
}
