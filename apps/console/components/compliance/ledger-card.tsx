"use client"

import { FileClockIcon } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import type { LedgerChain } from "@/lib/views/compliance"

import { PaginationBar, usePagination } from "../pagination-bar"
import { CopyHash } from "./copy-hash"

const PAGE_SIZE = 10

const COLUMN_STATUS = { observed: "Observed", reported: "Reported", resolved: "Resolved" } as const

export function LedgerCard({
  chains,
  selectedId,
  onSelect,
  zoneLabel,
}: {
  chains: LedgerChain[]
  selectedId: string
  onSelect: (clientId: string) => void
  zoneLabel: string
}) {
  const chain = chains.find((c) => c.clientId === selectedId) ?? chains[0]
  const records = chain?.records ?? []
  const items = chains.map((c) => ({
    value: c.clientId,
    label: c.sharing ? c.clientName : `${c.clientName} (sharing paused)`,
  }))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Signed Evidence Records</CardTitle>
        <CardDescription>
          {chain
            ? `Showing the hash chain for ${chain.clientName}: ${records.length} signed records, newest first. Times in ${zoneLabel}. ${chain.verified ? "Chain and signatures verified." : "Chain verification failed."}`
            : "Every observation, report, and resolution is chained and signed."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field className="max-w-sm">
          <FieldLabel htmlFor="ledger-client">Client</FieldLabel>
          <Select
            items={items}
            value={chain?.clientId ?? null}
            onValueChange={(value) => value && onSelect(value)}
          >
            <SelectTrigger id="ledger-client" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {records.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileClockIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                {chain && !chain.sharing ? "Hidden By Family Choice" : "No Signed Records Yet"}
              </EmptyTitle>
              <EmptyDescription>
                {chain && !chain.sharing
                  ? "The family withdrew sharing, so this chain is not shown to the agency."
                  : "Records appear as door events, notes, and resolutions are signed."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <LedgerTable key={chain?.clientId} records={records} />
        )}
      </CardContent>
    </Card>
  )
}

function LedgerTable({ records }: { records: LedgerChain["records"] }) {
  const pager = usePagination(records, PAGE_SIZE)
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Seq</TableHead>
            <TableHead>Column</TableHead>
            <TableHead>Recorded</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Payload Hash</TableHead>
            <TableHead>Prev Hash</TableHead>
            <TableHead>Signature</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pager.slice.map((record) => (
            <TableRow key={record.seq}>
              <TableCell className="tabular-nums">{record.seq}</TableCell>
              <TableCell>{COLUMN_STATUS[record.column]}</TableCell>
              <TableCell className="whitespace-nowrap">{record.at}</TableCell>
              <TableCell className="max-w-40 truncate font-mono text-xs">
                {record.subject}
              </TableCell>
              <TableCell>
                <CopyHash label="Payload Hash" value={record.payloadHash} />
              </TableCell>
              <TableCell>
                <CopyHash label="Previous Hash" value={record.prevHash} />
              </TableCell>
              <TableCell>
                <CopyHash label="Signature" value={record.signature} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <PaginationBar
        page={pager.page}
        pageCount={pager.pageCount}
        total={records.length}
        label="Records"
        onPage={pager.setPage}
      />
    </>
  )
}
