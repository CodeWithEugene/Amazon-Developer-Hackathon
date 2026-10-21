import { whepCapFor } from "./schemas/media"

/**
 * Browser WHEP live view helper (docs/research.md Section 2.6 pattern):
 * track handlers are attached BEFORE `createOffer`; both transceivers are
 * recvonly; the offer is sent once ICE gathering completes; `getStats`
 * detects a stalled connection. Ring caps sessions at 30 s (battery) or 60 s
 * (wired) and never reaps them, so this helper enforces the cap with a
 * countdown, DELETEs on explicit stop and at the cap, and registers a
 * `pagehide` keepalive DELETE so closing the tab never leaks a session.
 * Browser-safe: no Node imports (import from "@visitproof/ring-partner-sdk/whep").
 */

export type WhepEndReason = "cap" | "stopped" | "unload"

export interface WhepCountdown {
  readonly remainingMs: number
  readonly totalMs: number
}

type UnloadTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">

export interface WhepPeerOptions {
  /** The `<video>` element the remote track is attached to. */
  readonly videoEl: HTMLVideoElement | { srcObject: MediaStream | null }
  /** POSTs the SDP offer, returns the SDP answer and the session URL. */
  readonly signaling: (sdpOffer: string) => Promise<{ sdpAnswer: string; sessionUrl: string }>
  /** DELETEs the session URL (explicit stop and cap). */
  readonly teardown?: (sessionUrl: string) => Promise<void>
  /** Fire-and-forget DELETE on page unload; defaults to `fetch(url, { method: "DELETE", keepalive: true })`. */
  readonly keepaliveTeardown?: (sessionUrl: string) => void
  /** ICE servers for the peer connection; empty for direct local media. */
  readonly iceServers?: RTCIceServer[]
  /** Stall detection: called when no inbound packets arrive for `stallMs`. */
  readonly onStall?: () => void
  readonly stallMs?: number
  /** Session cap; defaults to 30 s, or 60 s when `batteryPowered` is false. */
  readonly maxDurationMs?: number
  readonly batteryPowered?: boolean
  /** Called at start and every `countdownIntervalMs` with the time left. */
  readonly onCountdown?: (countdown: WhepCountdown) => void
  readonly countdownIntervalMs?: number
  readonly onEnded?: (reason: WhepEndReason) => void
  /** Test seams. */
  readonly createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection
  readonly unloadTarget?: UnloadTarget
  readonly now?: () => number
}

export interface WhepPeer {
  start(): Promise<void>
  stop(): Promise<void>
  sessionUrl(): string | undefined
}

const DEFAULT_STALL_MS = 5_000
const DEFAULT_COUNTDOWN_INTERVAL_MS = 250

const waitForIceGathering = (pc: RTCPeerConnection, timeoutMs = 2_000): Promise<void> =>
  new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve()
    const done = (): void => {
      pc.removeEventListener("icegatheringstatechange", onChange)
      clearTimeout(timer)
      resolve()
    }
    const onChange = (): void => {
      if (pc.iceGatheringState === "complete") done()
    }
    const timer = setTimeout(done, timeoutMs)
    pc.addEventListener("icegatheringstatechange", onChange)
  })

const defaultKeepalive = (sessionUrl: string): void => {
  void fetch(sessionUrl, { method: "DELETE", keepalive: true }).catch(() => undefined)
}

const resolvePeerFactory = (options: WhepPeerOptions) => {
  if (options.createPeerConnection) return options.createPeerConnection
  if (typeof globalThis.RTCPeerConnection !== "function") {
    throw new Error("createWhepPeer requires a browser (RTCPeerConnection is unavailable)")
  }
  return (config: RTCConfiguration) => new RTCPeerConnection(config)
}

const watchForStall = (
  connection: RTCPeerConnection,
  options: WhepPeerOptions
): ReturnType<typeof setInterval> => {
  let lastPackets = 0
  return setInterval(async () => {
    const stats = await connection.getStats()
    stats.forEach((report) => {
      if (report.type === "inbound-rtp" && "packetsReceived" in report) {
        const packets = Number(report.packetsReceived)
        if (packets === lastPackets && packets > 0) options.onStall?.()
        lastPackets = packets
      }
    })
  }, options.stallMs ?? DEFAULT_STALL_MS)
}

const negotiate = async (connection: RTCPeerConnection, options: WhepPeerOptions): Promise<string> => {
  // Handlers BEFORE createOffer, per the documented pattern.
  connection.addTransceiver("video", { direction: "recvonly" })
  connection.addTransceiver("audio", { direction: "recvonly" })
  connection.addEventListener("track", (event) => {
    options.videoEl.srcObject = (event as RTCTrackEvent).streams[0] ?? null
  })
  const offer = await connection.createOffer()
  await connection.setLocalDescription(offer)
  await waitForIceGathering(connection)
  return connection.localDescription?.sdp ?? offer.sdp ?? ""
}

export const createWhepPeer = (options: WhepPeerOptions): WhepPeer => {
  const createPc = resolvePeerFactory(options)
  const unloadTarget: UnloadTarget | undefined =
    options.unloadTarget ?? (typeof window === "undefined" ? undefined : window)
  const now = options.now ?? Date.now
  const totalMs = options.maxDurationMs ?? whepCapFor(options.batteryPowered)
  let pc: RTCPeerConnection | undefined
  let sessionUrl: string | undefined
  let timers: ReturnType<typeof setInterval>[] = []
  let stopped = true

  const clearLocal = (): void => {
    timers.forEach((timer) => clearInterval(timer))
    timers = []
    unloadTarget?.removeEventListener("pagehide", onPageHide)
    pc?.close()
    pc = undefined
  }

  const end = async (reason: WhepEndReason): Promise<void> => {
    const url = sessionUrl
    sessionUrl = undefined
    stopped = true
    clearLocal()
    if (url && options.teardown) await options.teardown(url)
    if (url) options.onEnded?.(reason)
  }

  function onPageHide(): void {
    const url = sessionUrl
    sessionUrl = undefined
    stopped = true
    clearLocal()
    if (url) (options.keepaliveTeardown ?? defaultKeepalive)(url)
    if (url) options.onEnded?.("unload")
  }

  const startCountdown = (): void => {
    const startedAt = now()
    const tick = (): void => {
      const remainingMs = Math.max(0, totalMs - (now() - startedAt))
      options.onCountdown?.({ remainingMs, totalMs })
      if (remainingMs === 0) void end("cap")
    }
    tick()
    timers = [...timers, setInterval(tick, options.countdownIntervalMs ?? DEFAULT_COUNTDOWN_INTERVAL_MS)]
  }

  return {
    async start() {
      if (!stopped) return
      stopped = false
      const connection = createPc({ iceServers: options.iceServers ? [...options.iceServers] : [] })
      pc = connection
      const sdpOffer = await negotiate(connection, options)
      if (stopped) return clearLocal()
      const answer = await options.signaling(sdpOffer)
      if (stopped) {
        // stop() ran while signaling was in flight: the session exists on
        // Ring's side now and would never be reaped, so DELETE it at once.
        clearLocal()
        if (options.teardown) await options.teardown(answer.sessionUrl)
        return
      }
      sessionUrl = answer.sessionUrl
      unloadTarget?.addEventListener("pagehide", onPageHide)
      await connection.setRemoteDescription({ type: "answer", sdp: answer.sdpAnswer })
      timers = [...timers, watchForStall(connection, options)]
      startCountdown()
    },
    async stop() {
      stopped = true
      await end("stopped")
      clearLocal()
    },
    sessionUrl: () => sessionUrl,
  }
}
