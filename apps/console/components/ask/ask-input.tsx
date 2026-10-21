"use client"

import { useState } from "react"
import { MicIcon, MicOffIcon, SendIcon, Volume2Icon, VolumeOffIcon } from "lucide-react"

import { Field, FieldDescription, FieldLabel } from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { Spinner } from "@workspace/ui/components/spinner"
import { Toggle } from "@workspace/ui/components/toggle"

import { useSpeechInput } from "./use-speech"

interface AskInputProps {
  busy: boolean
  voiceReplies: boolean
  voiceRepliesSupported: boolean
  onVoiceRepliesChange: (value: boolean) => void
  onAsk: (text: string) => void
}

/** The "Ask VisitProof" box: type, or speak with browser speech recognition. */
export function AskInput({ busy, voiceReplies, voiceRepliesSupported, onVoiceRepliesChange, onAsk }: AskInputProps) {
  const [text, setText] = useState("")
  const speech = useSpeechInput()

  const submit = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed || busy) return
    onAsk(trimmed)
    setText("")
  }

  const listen = () => {
    if (speech.listening) {
      speech.stop()
      return
    }
    speech.start((transcript) => submit(transcript))
  }

  const hint = speech.error ?? (speech.supported ? "Press the microphone and speak, or type and press Enter." : "Type and press Enter. Voice input needs a browser with speech recognition.")

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit(text)
      }}
    >
      <Field>
        <FieldLabel htmlFor="ask-visitproof-input" className="sr-only">
          Ask VisitProof
        </FieldLabel>
        <InputGroup>
          <InputGroupInput
            id="ask-visitproof-input"
            placeholder="Ask VisitProof"
            value={text}
            maxLength={500}
            autoComplete="off"
            onChange={(event) => setText(event.target.value)}
          />
          <InputGroupAddon align="inline-end">
            {speech.supported ? (
              <InputGroupButton size="icon-xs" onClick={listen} aria-pressed={speech.listening} aria-label={speech.listening ? "Stop Listening" : "Speak A Question"}>
                {speech.listening ? <MicOffIcon aria-hidden="true" /> : <MicIcon aria-hidden="true" />}
              </InputGroupButton>
            ) : null}
            <InputGroupButton type="submit" size="icon-xs" variant="default" disabled={busy || text.trim().length === 0} aria-label="Ask">
              {busy ? <Spinner aria-hidden="true" /> : <SendIcon aria-hidden="true" />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FieldDescription>{hint}</FieldDescription>
          {voiceRepliesSupported ? (
            <Toggle variant="outline" size="sm" pressed={voiceReplies} onPressedChange={onVoiceRepliesChange}>
              {voiceReplies ? <Volume2Icon data-icon="inline-start" aria-hidden="true" /> : <VolumeOffIcon data-icon="inline-start" aria-hidden="true" />}
              Read Replies Aloud
            </Toggle>
          ) : null}
        </div>
      </Field>
    </form>
  )
}
