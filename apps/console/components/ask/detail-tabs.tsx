"use client"

import { Badge } from "@workspace/ui/components/badge"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import { BRAIN_LABELS, type DeviceSize, type Turn } from "./ask-types"
import { DeviceCard } from "./device-card"

/** Bottom tabs mirroring the Alexa+ web simulator: Response Detail, Trace, and Visual. */
export function DetailTabs({ turn, size }: { turn?: Turn; size: DeviceSize }) {
  if (!turn) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>No Response Yet</EmptyTitle>
          <EmptyDescription>The raw MCP tool calls, timings, and visual appear here after the first answer.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  const detail = turn.toolCalls.map((call) => ({
    request: { method: "tools/call", params: { name: call.name, arguments: call.arguments } },
    result: { isError: call.isError, content: [{ type: "text", text: call.text }], structuredContent: call.structuredContent },
  }))
  const total = turn.trace.reduce((sum, step) => sum + step.durationMs, 0)
  return (
    <Tabs defaultValue="detail">
      <TabsList>
        <TabsTrigger value="detail">Response Detail</TabsTrigger>
        <TabsTrigger value="trace">Trace</TabsTrigger>
        <TabsTrigger value="visual">Visual</TabsTrigger>
      </TabsList>
      <TabsContent value="detail" className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          {BRAIN_LABELS[turn.brain]}: {turn.reasoning}
        </p>
        <pre className="max-h-96 overflow-auto rounded-lg border bg-muted p-3 font-mono text-xs" tabIndex={0} aria-label="MCP tool calls and results">
          {JSON.stringify(detail, null, 2)}
        </pre>
      </TabsContent>
      <TabsContent value="trace">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Step</TableHead>
              <TableHead>Detail</TableHead>
              <TableHead className="text-right">Milliseconds</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {turn.trace.map((step, index) => (
              <TableRow key={`${step.step}-${index}`}>
                <TableCell className="font-mono text-xs">{step.step}</TableCell>
                <TableCell>{step.detail ? <Badge variant="outline">{step.detail}</Badge> : null}</TableCell>
                <TableCell className="text-right tabular-nums">{step.durationMs}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-medium">Total</TableCell>
              <TableCell />
              <TableCell className="text-right font-medium tabular-nums">{total}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TabsContent>
      <TabsContent value="visual">
        <DeviceCard call={turn.toolCalls.at(-1)} spoken={turn.spoken} size={size} />
      </TabsContent>
    </Tabs>
  )
}
