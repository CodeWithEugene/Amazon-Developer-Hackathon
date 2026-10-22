"use client"

import { useEffect, useRef, useState } from "react"
import { PlayIcon, SquareIcon, TriangleAlertIcon } from "lucide-react"

import { createWhepPeer, type WhepPeer } from "@visitproof/ring-partner-sdk/whep"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldDescription, FieldLabel } from "@workspace/ui/components/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"

import { CapCountdown } from "@/components/ring/cap-countdown"
import { ENDED_TEXT, noVideoNotice, STOP_UNCONFIRMED_TEXT, type LiveViewSource } from "@/lib/ring/live-view-copy"
import { startOutcome } from "@/lib/ring/live-view-state"
import type { LiveDevice } from "@/lib/ring/views"

type Status = "idle" | "connecting" | "live" | "ended" | "no_video" | "error"

/** Shown when Ring connected but no frame decoded in time (session already stopped). */
function NoVideoAlert({ source }: { source: LiveViewSource }) {
  const notice = noVideoNotice(source)
  return (
    <Alert variant="warning">
      <TriangleAlertIcon aria-hidden="true" />
      <AlertTitle>{notice.title}</AlertTitle>
      <AlertDescription>{notice.description}</AlertDescription>
    </Alert>
  )
}

class SignalingError extends Error {}

const signaling = async (deviceId: string, sdpOffer: string) => {
  const response = await fetch("/api/ring/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, sdpOffer }),
  })
  const body = (await response.json().catch(() => ({}))) as { sdpAnswer?: string; sessionUrl?: string; error?: string }
  if (!response.ok || !body.sdpAnswer || !body.sessionUrl) {
    throw new SignalingError(
      response.status === 503
        ? body.error ?? "The doorbell is not available for live view right now. Try again in a minute."
        : body.error ?? "Live view could not start. Try again."
    )
  }
  return { sdpAnswer: body.sdpAnswer, sessionUrl: body.sessionUrl }
}

const teardown = async (sessionUrl: string): Promise<void> => {
  const response = await fetch(sessionUrl, { method: "DELETE" })
  if (!response.ok && response.status !== 404) throw new Error(`Stop failed with ${response.status}`)
}

/**
 * WHEP live view: recvonly, time boxed by Ring's cap, explicit Stop. If the
 * connection is up but no frame decodes within 8 seconds, the peer DELETEs
 * the session and a warning explains why (the Playground sandbox doorbell
 * only streams while a simulated event is running; confirmed live).
 */
export function LiveView({
  devices,
  provenanceLabel,
  source,
}: {
  devices: LiveDevice[]
  provenanceLabel: string
  source: LiveViewSource
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const peerRef = useRef<WhepPeer | null>(null)
  const [deviceId, setDeviceId] = useState<string | null>(devices[0]?.id ?? null)
  const [status, setStatus] = useState<Status>("idle")
  const [message, setMessage] = useState<string>("")
  const [countdown, setCountdown] = useState<{ remainingMs: number; totalMs: number } | null>(null)
  const device = devices.find((candidate) => candidate.id === deviceId)
  const items = devices.map((candidate) => ({ value: candidate.id, label: candidate.name }))

  useEffect(() => () => void peerRef.current?.stop().catch(() => undefined), [])

  async function start() {
    const video = videoRef.current
    if (!device || !video) return
    setStatus("connecting")
    setMessage("")
    const peer = createWhepPeer({
      videoEl: video,
      batteryPowered: device.batteryPowered,
      signaling: (sdpOffer) => signaling(device.id, sdpOffer),
      teardown,
      onCountdown: setCountdown,
      onEnded: (reason) => {
        // A peer the component already let go of (Stop, or a newer start) must not overwrite the UI.
        if (peerRef.current !== peer) return
        setStatus(reason === "no_video" ? "no_video" : "ended")
        setCountdown(null)
        setMessage(ENDED_TEXT[reason])
      },
      onStall: () => setMessage("The picture stalled. Ring may have lost the connection to the doorbell."),
    })
    peerRef.current = peer
    try {
      await peer.start()
      // Stop during negotiate or signaling makes start() resolve with no session.
      if (startOutcome({ isCurrent: peerRef.current === peer, sessionUrl: peer.sessionUrl() }) === "live") {
        setStatus("live")
      }
    } catch (error) {
      await peer.stop().catch(() => undefined)
      if (peerRef.current !== peer) return
      setStatus("error")
      setMessage(error instanceof SignalingError ? error.message : "Live view could not start in this browser.")
    }
  }

  // The component owns the stopped state: onEnded only fires when a session
  // existed, which is not the case while the peer is still connecting.
  async function stop() {
    const peer = peerRef.current
    peerRef.current = null
    setStatus("ended")
    setCountdown(null)
    setMessage(ENDED_TEXT.stopped)
    try {
      await peer?.stop()
    } catch {
      setMessage(STOP_UNCONFIRMED_TEXT)
    }
  }

  const running = status === "connecting" || status === "live"
  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="live-device">Doorbell</FieldLabel>
        <Select items={items} value={deviceId} onValueChange={(value) => setDeviceId(value)} disabled={running}>
          <SelectTrigger id="live-device" className="w-full">
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
        <FieldDescription>
          {device?.online === false ? "Ring reports this doorbell as offline. " : ""}Source: {provenanceLabel}.
        </FieldDescription>
      </Field>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        aria-label={device ? `Live view from ${device.name}` : "Live view"}
        className="aspect-video w-full rounded-lg border bg-muted"
      />
      {countdown && status === "live" ? <CapCountdown {...countdown} /> : null}
      {status === "no_video" ? <NoVideoAlert source={source} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button variant="destructive" onClick={stop}>
            <SquareIcon data-icon="inline-start" aria-hidden="true" />
            Stop Live View
          </Button>
        ) : (
          <Button onClick={start} disabled={!device}>
            <PlayIcon data-icon="inline-start" aria-hidden="true" />
            Start Live View
          </Button>
        )}
        {status === "connecting" ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Connecting to Ring
          </span>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {message}
      </p>
    </div>
  )
}
