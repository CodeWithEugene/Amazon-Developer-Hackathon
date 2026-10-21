"use client"

import { useState } from "react"
import { FileCheckIcon, FileJsonIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import type { ComplianceData, LedgerChain } from "@/lib/views/compliance"

import { LedgerCard } from "./compliance/ledger-card"
import {
  inRange,
  ReconciliationCard,
  type RangeKey,
} from "./compliance/reconciliation-card"
import { NoDemoData } from "./today-board"

const RANGE_LABEL: Record<RangeKey, string> = {
  today: "Today",
  week: "This Week",
  "two-weeks": "Two Weeks",
}

export function ComplianceView({ data }: { data: ComplianceData }) {
  const [range, setRange] = useState<RangeKey>("two-weeks")
  const firstSharing = data.chains.find((c) => c.sharing) ?? data.chains[0]
  const [clientId, setClientId] = useState(firstSharing?.clientId ?? "")
  if (data.storeEmpty) return <NoDemoData />
  const ranged = data.rows.filter((row) => inRange(row, range, data.today))
  const corroborated = ranged.filter(
    (r) => r.outcome === "corroborated" || r.outcome === "corroborated_with_variance"
  ).length
  const chain = data.chains.find((c) => c.clientId === clientId)
  const pdfHref = `/api/compliance/export?format=pdf&clientId=${encodeURIComponent(clientId)}`
  return (
    <div className="flex flex-col gap-6">
      <SummaryCards
        rangeLabel={RANGE_LABEL[range]}
        reconciled={ranged.length}
        corroborated={corroborated}
        hiddenClients={data.hiddenClients}
        chain={chain}
        pdfHref={pdfHref}
      />
      <ReconciliationCard rows={data.rows} today={data.today} range={range} onRange={setRange} />
      <LedgerCard
        chains={data.chains}
        selectedId={clientId}
        onSelect={setClientId}
        zoneLabel={data.zoneLabel}
      />
    </div>
  )
}

function SummaryCards(props: {
  rangeLabel: string
  reconciled: number
  corroborated: number
  hiddenClients: number
  chain: LedgerChain | undefined
  pdfHref: string
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <ReconciledCard {...props} />
      <LedgerSummaryCard chain={props.chain} />
      <ExportCard chain={props.chain} pdfHref={props.pdfHref} />
    </div>
  )
}

function ReconciledCard({
  rangeLabel,
  reconciled,
  corroborated,
  hiddenClients,
}: {
  rangeLabel: string
  reconciled: number
  corroborated: number
  hiddenClients: number
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>Visits Reconciled, {rangeLabel}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{reconciled}</CardTitle>
      </CardHeader>
      <CardFooter>
        <p className="text-xs text-muted-foreground">
          {corroborated} corroborated by EVV clock-in.
          {hiddenClients > 0 ? ` ${hiddenClients} client hidden by family choice.` : ""}
        </p>
      </CardFooter>
    </Card>
  )
}

function LedgerSummaryCard({ chain }: { chain: LedgerChain | undefined }) {
  const status = chain?.verified
    ? "Chain and signatures verified. HMAC stand-in for the demo; KMS ECDSA P-256 in production."
    : "Chain verification failed. These records may have been altered."
  return (
    <Card>
      <CardHeader>
        <CardDescription>Signed Ledger Records</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{chain?.records.length ?? 0}</CardTitle>
      </CardHeader>
      <CardFooter>
        <p className="text-xs text-muted-foreground">
          {chain ? `${chain.clientName}. ${status}` : "Choose a client below."}
        </p>
      </CardFooter>
    </Card>
  )
}

function ExportCard({ chain, pdfHref }: { chain: LedgerChain | undefined; pdfHref: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>Evidence Exports</CardDescription>
        <CardTitle>Download Pack</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!chain?.sharing}
          render={<a href={pdfHref} download />}
          nativeButton={false}
        >
          <FileCheckIcon data-icon="inline-start" aria-hidden="true" />
          PDF For {chain?.clientName ?? "Client"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          render={<a href="/api/compliance/export?format=json" download />}
          nativeButton={false}
        >
          <FileJsonIcon data-icon="inline-start" aria-hidden="true" />
          Alternate EVV JSON
        </Button>
      </CardContent>
    </Card>
  )
}
