"use client"

import { FileCheckIcon, FileJsonIcon } from "lucide-react"

import { StatusBadge } from "@workspace/ui/components/status-badge"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"

import { formatTime, formatWindow } from "@/lib/format"
import type { EVVRecord, LedgerRecord, Visit } from "@visitproof/domain"

export interface ReconciliationRow {
  visit: Visit
  clientName: string
  caregiverName: string
  evv: EVVRecord | undefined
}

export function ComplianceView({
  rows,
  ledger,
  chainVerified,
}: {
  rows: ReconciliationRow[]
  ledger: LedgerRecord[]
  chainVerified: boolean
}) {
  const corroborated = rows.filter((r) =>
    isCorroborated(r.visit.reconciliation?.outcome)
  ).length

  function download(format: "pdf" | "json") {
    window.location.href = `/api/compliance/export?format=${format}`
    return undefined
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="py-4">
          <CardHeader>
            <CardDescription>Visits Reconciled Today</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {rows.length}
            </CardTitle>
          </CardHeader>
          <CardFooter className="text-xs text-muted-foreground">
            {corroborated} corroborated by EVV clock-in
          </CardFooter>
        </Card>
        <Card className="py-4">
          <CardHeader>
            <CardDescription>Signed Ledger Records</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {ledger.length}
            </CardTitle>
          </CardHeader>
          <CardFooter className="text-xs text-muted-foreground">
            {chainVerified
              ? "Chain and signatures verified. HMAC stand-in for the demo; KMS ECDSA P-256 in production."
              : "Chain verification failed. These records may have been altered."}
          </CardFooter>
        </Card>
        <Card className="py-4">
          <CardHeader>
            <CardDescription>Evidence Exports</CardDescription>
            <CardTitle className="text-base">Download Pack</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => download("pdf")}>
              <FileCheckIcon data-icon="inline-start" aria-hidden="true" />
              PDF Evidence Pack
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => download("json")}
            >
              <FileJsonIcon data-icon="inline-start" aria-hidden="true" />
              Alternate EVV JSON
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reconciliation</CardTitle>
          <CardDescription>
            Door observations joined with EVV clock-ins. Corroborated,
            contradicted, missing clock-in, and unobservable outcomes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="all">
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="corroborated">Corroborated</TabsTrigger>
              <TabsTrigger value="contradicted">Contradicted</TabsTrigger>
              <TabsTrigger value="missing">Missing</TabsTrigger>
              <TabsTrigger value="unobservable">Unobservable</TabsTrigger>
            </TabsList>
            <TabsContent value="all">
              <ReconciliationTable rows={rows} />
            </TabsContent>
            <TabsContent value="corroborated">
              <ReconciliationTable
                rows={rows.filter((r) =>
                  isCorroborated(r.visit.reconciliation?.outcome)
                )}
              />
            </TabsContent>
            <TabsContent value="contradicted">
              <ReconciliationTable
                rows={rows.filter(
                  (r) => r.visit.reconciliation?.outcome === "contradicted"
                )}
              />
            </TabsContent>
            <TabsContent value="missing">
              <ReconciliationTable
                rows={rows.filter((r) => {
                  const outcome = r.visit.reconciliation?.outcome
                  return (
                    outcome === "missing_clock_in" || outcome === "missing_both"
                  )
                })}
              />
            </TabsContent>
            <TabsContent value="unobservable">
              <ReconciliationTable
                rows={rows.filter(
                  (r) => r.visit.reconciliation?.outcome === "unobservable"
                )}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Signed Evidence Records</CardTitle>
          <CardDescription>
            Every observation, report, and resolution is chained and signed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Seq</TableHead>
                <TableHead>Column</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Payload Hash</TableHead>
                <TableHead>Prev Hash</TableHead>
                <TableHead>Signature</TableHead>
                <TableHead>At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.map((record) => (
                <TableRow key={`${record.clientId}-${record.seq}`}>
                  <TableCell className="tabular-nums">{record.seq}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{record.column}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {record.subject}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {record.payloadHash}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {record.prevHash}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {record.signature}
                  </TableCell>
                  <TableCell>{formatTime(record.at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

/** corroborated_with_variance (10–30 min deltas) belongs in the corroborated bucket. */
function isCorroborated(outcome: string | undefined): boolean {
  return (
    outcome === "corroborated" || outcome === "corroborated_with_variance"
  )
}

function ReconciliationTable({ rows }: { rows: ReconciliationRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No visits in this category.
      </p>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Client</TableHead>
          <TableHead>Caregiver</TableHead>
          <TableHead>Window</TableHead>
          <TableHead>Door Arrival</TableHead>
          <TableHead>Door Departure</TableHead>
          <TableHead>Clock-In</TableHead>
          <TableHead>Outcome</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ visit, clientName, caregiverName }) => (
          <TableRow key={visit.id}>
            <TableCell>{clientName}</TableCell>
            <TableCell>{caregiverName}</TableCell>
            <TableCell>
              {formatWindow(visit.scheduledStart, visit.scheduledEnd)}
            </TableCell>
            <TableCell>{formatTime(visit.arrival?.at)}</TableCell>
            <TableCell>{formatTime(visit.departure?.at)}</TableCell>
            <TableCell>{formatTime(visit.reconciliation?.clockIn)}</TableCell>
            <TableCell>
              <StatusBadge
                status={visit.reconciliation?.outcome ?? "pending"}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
