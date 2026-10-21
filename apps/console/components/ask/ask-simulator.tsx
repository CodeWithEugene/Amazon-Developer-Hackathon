"use client"

import { useState } from "react"
import { InfoIcon, MonitorSmartphoneIcon } from "lucide-react"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { toast } from "@workspace/ui/components/toast"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"

import { AskInput } from "./ask-input"
import { askErrorSchema, askResponseSchema, BRAIN_LABELS, SUGGESTIONS, type DeviceSize, type Pending, type Turn } from "./ask-types"
import { Conversation, type ConversationEntry } from "./conversation"
import { DetailTabs } from "./detail-tabs"
import { DeviceCard } from "./device-card"
import { ASK_PROVENANCE } from "./provenance"
import { useSpeechOutput } from "./use-speech"

interface AskSimulatorProps {
  persona: Turn["persona"]
  brain: Turn["brain"]
  mcpUrl: string
}

const postTurn = async (utterance: string, pending?: Pending): Promise<Turn> => {
  const response = await fetch("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ utterance, ...(pending ? { pending } : {}) }),
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const parsed = askErrorSchema.safeParse(body)
    throw new Error(parsed.success ? parsed.data.error : `Ask VisitProof failed with status ${response.status}.`)
  }
  const parsed = askResponseSchema.safeParse(body)
  if (!parsed.success) throw new Error("Ask VisitProof returned an unexpected response.")
  return parsed.data.turn
}

/** Ask VisitProof: a simulated Alexa+ experience in the layout of Amazon's web simulator. */
export function AskSimulator({ persona, brain, mcpUrl }: AskSimulatorProps) {
  const [entries, setEntries] = useState<readonly ConversationEntry[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [pending, setPending] = useState<Pending>()
  const [size, setSize] = useState<DeviceSize>("large")
  const [voiceReplies, setVoiceReplies] = useState(false)
  const voice = useSpeechOutput()
  const busy = entries.some((entry) => !entry.turn && !entry.error)
  const selected = entries.find((entry) => entry.id === selectedId)?.turn ?? [...entries].reverse().find((entry) => entry.turn)?.turn

  const ask = async (utterance: string) => {
    const id = crypto.randomUUID()
    setEntries((current) => [...current, { id, utterance }])
    try {
      const turn = await postTurn(utterance, pending)
      setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, turn } : entry)))
      setSelectedId(id)
      setPending(turn.pendingConfirmation)
      if (voiceReplies) voice.speak(turn.spoken)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ask VisitProof failed."
      setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, error: message } : entry)))
      toast.add({ type: "error", title: "No Answer", description: message })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Alert>
        <InfoIcon aria-hidden="true" />
        <AlertTitle>Simulated Alexa+ Experience</AlertTitle>
        <AlertDescription>
          {ASK_PROVENANCE} Brain: {BRAIN_LABELS[brain]}. MCP endpoint: {mcpUrl}. Asking as the {persona === "family" ? "family" : "agency"}.
        </AlertDescription>
      </Alert>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Card className="min-h-[28rem]">
          <CardHeader>
            <CardTitle>Conversation</CardTitle>
            <CardDescription>Speak or type. Each answer is a real MCP tool call.</CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-72 flex-1 flex-col lg:h-96">
            <Conversation entries={entries} selectedId={selectedId} suggestions={SUGGESTIONS[persona]} onSelect={setSelectedId} onSuggestion={ask} />
          </CardContent>
          <CardFooter className="flex flex-col items-stretch gap-3 border-t pt-4">
            {pending ? (
              <Alert variant="warning">
                <AlertTitle>Waiting For Your Yes</AlertTitle>
                <AlertDescription>Say yes to confirm or no to cancel. Nothing is written until you confirm.</AlertDescription>
                <AlertAction className="flex gap-2">
                  <Button size="xs" onClick={() => ask("Yes")} disabled={busy}>Confirm</Button>
                  <Button size="xs" variant="outline" onClick={() => ask("No")} disabled={busy}>Cancel</Button>
                </AlertAction>
              </Alert>
            ) : null}
            <AskInput busy={busy} voiceReplies={voiceReplies} voiceRepliesSupported={voice.supported} onVoiceRepliesChange={setVoiceReplies} onAsk={ask} />
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Device Preview</CardTitle>
            <CardDescription>The structured content from the tool, rendered as a card.</CardDescription>
            <CardAction>
              <ToggleGroup variant="outline" size="sm" value={[size]} onValueChange={(value: string[]) => setSize(value[0] === "small" ? "small" : "large")} aria-label="Echo Show size">
                <ToggleGroupItem value="small">Echo Show Small</ToggleGroupItem>
                <ToggleGroupItem value="large">Echo Show Large</ToggleGroupItem>
              </ToggleGroup>
            </CardAction>
          </CardHeader>
          <CardContent className="flex justify-center">
            <div className={cn("flex w-full flex-col overflow-hidden rounded-2xl border-8 border-foreground/80 bg-muted p-2", size === "small" ? "aspect-[1024/600] max-w-sm" : "aspect-[16/10] max-w-2xl")}>
              {selected ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <DeviceCard call={selected.toolCalls.at(-1)} spoken={selected.spoken} size={size} />
                </div>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
                  <MonitorSmartphoneIcon aria-hidden="true" />
                  <p className="text-sm">Ask a question to see the Echo Show card.</p>
                </div>
              )}
            </div>
          </CardContent>
          {selected ? (
            <CardFooter className="flex flex-wrap gap-2">
              <Badge variant="outline">{BRAIN_LABELS[selected.brain]}</Badge>
              {selected.toolCalls.map((call, index) => (
                <Badge key={`${call.name}-${index}`} variant={call.isError ? "destructive" : "secondary"}>
                  {call.name}
                </Badge>
              ))}
            </CardFooter>
          ) : null}
        </Card>
      </div>
      <DetailTabs turn={selected} size={size} />
    </div>
  )
}
