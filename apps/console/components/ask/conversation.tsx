"use client"

import { MessageCircleQuestionIcon, WrenchIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Bubble, BubbleContent } from "@workspace/ui/components/bubble"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Marker, MarkerContent, MarkerIcon } from "@workspace/ui/components/marker"
import { Message, MessageContent, MessageFooter, MessageHeader } from "@workspace/ui/components/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller"
import { Spinner } from "@workspace/ui/components/spinner"

import { BRAIN_LABELS, toolTitle, type Turn } from "./ask-types"

export interface ConversationEntry {
  readonly id: string
  readonly utterance: string
  readonly turn?: Turn
  readonly error?: string
}

interface ConversationProps {
  entries: readonly ConversationEntry[]
  selectedId?: string
  suggestions: readonly string[]
  onSelect: (id: string) => void
  onSuggestion: (text: string) => void
}

function Reply({ entry, selected, onSelect }: { entry: ConversationEntry; selected: boolean; onSelect: () => void }) {
  if (entry.error) {
    return (
      <Bubble variant="destructive">
        <BubbleContent>{entry.error}</BubbleContent>
      </Bubble>
    )
  }
  if (!entry.turn) {
    return (
      <Bubble variant="muted">
        <BubbleContent className="flex items-center gap-2">
          <Spinner aria-hidden="true" />
          Asking the VisitProof MCP server
        </BubbleContent>
      </Bubble>
    )
  }
  const tools = [...new Set(entry.turn.toolCalls.map((call) => toolTitle(call.name)))].join(", ")
  return (
    <>
      <Bubble variant={selected ? "tinted" : "secondary"}>
        <BubbleContent render={<button type="button" onClick={onSelect} aria-pressed={selected} />}>{entry.turn.spoken}</BubbleContent>
      </Bubble>
      <MessageFooter className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{BRAIN_LABELS[entry.turn.brain]}</Badge>
        {tools ? (
          <Marker className="w-auto">
            <MarkerIcon>
              <WrenchIcon aria-hidden="true" />
            </MarkerIcon>
            <MarkerContent>{tools}</MarkerContent>
          </Marker>
        ) : null}
      </MessageFooter>
    </>
  )
}

export function Conversation({ entries, selectedId, suggestions, onSelect, onSuggestion }: ConversationProps) {
  if (entries.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageCircleQuestionIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Ask VisitProof Anything About Today</EmptyTitle>
          <EmptyDescription>Speak or type a question. Each answer comes from a real MCP tool call.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex flex-wrap justify-center gap-2">
          {suggestions.map((text) => (
            <Button key={text} variant="outline" size="sm" onClick={() => onSuggestion(text)}>
              {text}
            </Button>
          ))}
        </EmptyContent>
      </Empty>
    )
  }
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller>
        <MessageScrollerViewport aria-label="Conversation" aria-live="polite">
          <MessageScrollerContent className="p-1">
            {entries.map((entry) => (
              <MessageScrollerItem key={entry.id} messageId={entry.id} scrollAnchor>
                <div className="flex flex-col gap-3">
                  <Message align="end">
                    <MessageContent>
                      <MessageHeader className="sr-only">You said</MessageHeader>
                      <Bubble align="end">
                        <BubbleContent>{entry.utterance}</BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
                  <Message align="start">
                    <MessageContent>
                      <MessageHeader>VisitProof</MessageHeader>
                      <Reply entry={entry} selected={entry.id === selectedId} onSelect={() => onSelect(entry.id)} />
                    </MessageContent>
                  </Message>
                </div>
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
