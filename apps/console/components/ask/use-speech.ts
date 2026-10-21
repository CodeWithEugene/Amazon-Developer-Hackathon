"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"

/**
 * Optional browser speech: recognition for the question (Web Speech API,
 * Chrome and Safari) and synthesis for the reply. Both degrade to typing and
 * reading when the browser lacks them.
 */
interface RecognitionResultEvent {
  readonly results: ArrayLike<ArrayLike<{ readonly transcript: string }>>
}

interface Recognition {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: RecognitionResultEvent) => void) | null
  onerror: ((event: { readonly error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

type RecognitionConstructor = new () => Recognition

const recognitionConstructor = (): RecognitionConstructor | undefined => {
  if (typeof window === "undefined") return undefined
  const scope = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition
}

export interface SpeechInput {
  readonly supported: boolean
  readonly listening: boolean
  readonly error: string | null
  start(onTranscript: (text: string) => void): void
  stop(): void
}

const noSubscription = () => () => {}

/** Browser capability as external state: false during server rendering, real on the client. */
const useCapability = (probe: () => boolean): boolean => useSyncExternalStore(noSubscription, probe, () => false)

const hasSynthesis = () => typeof window !== "undefined" && "speechSynthesis" in window

export function useSpeechInput(): SpeechInput {
  const supported = useCapability(() => recognitionConstructor() !== undefined)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = useRef<Recognition | null>(null)

  useEffect(() => () => active.current?.stop(), [])

  const start = useCallback((onTranscript: (text: string) => void) => {
    const Constructor = recognitionConstructor()
    if (!Constructor) return
    const recognition = new Constructor()
    recognition.lang = "en-US"
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim()
      if (transcript) onTranscript(transcript)
    }
    recognition.onerror = (event) => setError(event.error === "not-allowed" ? "Microphone access was blocked." : "I did not catch that.")
    recognition.onend = () => setListening(false)
    active.current = recognition
    setError(null)
    setListening(true)
    recognition.start()
  }, [])

  const stop = useCallback(() => active.current?.stop(), [])

  return { supported, listening, error, start, stop }
}

export function useSpeechOutput() {
  const supported = useCapability(hasSynthesis)

  const speak = useCallback((text: string) => {
    if (!hasSynthesis()) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = "en-US"
    window.speechSynthesis.speak(utterance)
  }, [])

  const cancel = useCallback(() => {
    if (hasSynthesis()) window.speechSynthesis.cancel()
  }, [])

  return { supported, speak, cancel }
}
