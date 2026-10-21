"use client"

import { useEffect, useRef, useState } from "react"
import { PlayIcon, SquareIcon } from "lucide-react"

import { createWhepPeer, type WhepEndReason, type WhepPeer } from "@visitproof/ring-partner-sdk/whep"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldDescription, FieldLabel } from "@workspace/ui/components/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"

import { CapCountdown } from "@/components/ring/cap-countdown"
import type { LiveDevice } from "@/lib/ring/views"

type Status = "idle" | "connecting" | "live" | "ended" | "error"

const ENDED_TEXT: Readonly<Record<WhepEndReason, string>> = {
  cap: "Live view ended at Ring's time limit. Start it again if you need another look.",
  stopped: "Live view stopped.",
  unload: "Live view stopped.",
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

/** WHEP live view: recvonly, time boxed by Ring's cap, explicit Stop. */
export function LiveView({ devices, provenanceLabel }: { devices: LiveDevice[]; provenanceLabel: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const peerRef = useRef<WhepPeer | null>(null)
  const [deviceId, setDeviceId] = useState<string | null>(devices[0]?.id ?? null)
  const [status, setStatus] = useState<Status>("idle")
  const [message, setMessage] = useState<string>("")
  const [countdown, setCountdown] = useState<{ remainingMs: number; totalMs: number } | null>(null)
  const device = devices.find((candidate) => candidate.id === deviceId)
  const items = devices.map((candidate) => ({ value: candidate.id, label: candidate.name }))

  useEffect(() => () => void peerRef.current?.stop(), [])

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
        setStatus("ended")
        setCountdown(null)
        setMessage(ENDED_TEXT[reason])
      },
      onStall: () => setMessage("The picture stalled. Ring may have lost the connection to the doorbell."),
    })
    peerRef.current = peer
    try {
      await peer.start()
      setStatus("live")
    } catch (error) {
      await peer.stop()
      setStatus("error")
      setMessage(error instanceof SignalingError ? error.message : "Live view could not start in this browser.")
    }
  }

  async function stop() {
    await peerRef.current?.stop()
    peerRef.current = null
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
