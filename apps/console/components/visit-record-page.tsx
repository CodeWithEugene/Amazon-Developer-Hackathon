import Link from "next/link"
import { ArrowLeftIcon, EyeOffIcon, SearchXIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { HonestBoundaries } from "@/components/honest-boundaries"
import { PageShell } from "@/components/page-shell"
import { VisitRecord } from "@/components/visit-record"
import type { Role } from "@/lib/roles"
import { loadVisitRecord } from "@/lib/views/visit-record"

/** Shared server page for /agency/visits/[id], /family/visits/[id], /me/visits/[id]. */
export async function VisitRecordPage({
  role,
  visitId,
  backHref,
}: {
  role: Role
  visitId: string
  backHref: string
}) {
  const result = await loadVisitRecord(visitId, role)
  return (
    <PageShell role={role} title="Visit Record" description="Three columns, never merged: Observed, Reported, and Resolved.">
      <div className="flex flex-col gap-6">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          render={<Link href={backHref} />}
          nativeButton={false}
        >
          <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
          Back
        </Button>
        <HonestBoundaries detail="Provenance is shown next to every entry." />
        {result.kind === "ok" ? (
          <VisitRecord data={result.data} />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {result.kind === "hidden" ? (
                  <EyeOffIcon aria-hidden="true" />
                ) : (
                  <SearchXIcon aria-hidden="true" />
                )}
              </EmptyMedia>
              <EmptyTitle>
                {result.kind === "hidden" ? "Hidden By Family Choice" : "Visit Not Found"}
              </EmptyTitle>
              <EmptyDescription>
                {result.kind === "hidden"
                  ? "The family withdrew sharing, so this visit's details are not shown to the agency."
                  : "This visit does not exist or is not part of your record."}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" render={<Link href={backHref} />} nativeButton={false}>
                Go Back
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </div>
    </PageShell>
  )
}
