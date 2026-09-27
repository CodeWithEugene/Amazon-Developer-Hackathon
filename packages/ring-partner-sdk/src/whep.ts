/**
 * Browser WHEP live view helper (docs/research.md Section 2.6 pattern):
 * track handlers are attached BEFORE `createOffer`; both transceivers are
 * recvonly; the offer is only sent once ICE gathering completes; `getStats`
 * detects a stalled connection; a keepalive DELETE of the session URL fires on
 * page unload. Server side this module is inert (no RTCPeerConnection).
 */

export interface WhepPeerOptions {
  /** The `<video>` element the remote track is attached to. */
  readonly videoEl: HTMLVideoElement | { srcObject: MediaStream | null }
  /** POSTs the SDP offer, returns the SDP answer and the session URL. */
  readonly signaling: (sdpOffer: string) => Promise<{ sdpAnswer: string; sessionUrl: string }>
  /** DELETEs the session URL (keepalive and explicit stop). */
  readonly teardown?: (sessionUrl: string) => Promise<void>
  /** ICE servers for the peer connection; empty for direct local media. */
  readonly iceServers?: RTCIceServer[]
  /** Stall detection: called when no inbound packets arrive for `stallMs`. */
  readonly onStall?: () => void
  readonly stallMs?: number
}

export interface WhepPeer {
  start(): Promise<void>
  stop(): Promise<void>
  sessionUrl(): string | undefined
}

const DEFAULT_STALL_MS = 5_000

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

export const createWhepPeer = (options: WhepPeerOptions): WhepPeer => {
  if (typeof globalThis.RTCPeerConnection !== "function") {
    throw new Error("createWhepPeer requires a browser (RTCPeerConnection is unavailable)")
  }
  let pc: RTCPeerConnection | undefined
  let sessionUrl: string | undefined
  let stallTimer: ReturnType<typeof setInterval> | undefined
  let stopped = false
  let lastPackets = 0

  const teardown = async (): Promise<void> => {
    if (stallTimer !== undefined) {
      clearInterval(stallTimer)
      stallTimer = undefined
    }
    pc?.close()
    pc = undefined
    const url = sessionUrl
    sessionUrl = undefined
    if (url && options.teardown) await options.teardown(url)
  }

  const watchForStall = (connection: RTCPeerConnection): void => {
    const stallMs = options.stallMs ?? DEFAULT_STALL_MS
    stallTimer = setInterval(async () => {
      const stats = await connection.getStats()
      stats.forEach((report) => {
        if (report.type === "inbound-rtp" && "packetsReceived" in report) {
          const packets = Number(report.packetsReceived)
          if (packets === lastPackets && packets > 0) options.onStall?.()
          lastPackets = packets
        }
      })
    }, stallMs)
  }

  return {
    async start() {
      stopped = false
      const connection = new RTCPeerConnection({
        iceServers: options.iceServers ? [...options.iceServers] : [],
      })
      pc = connection
      // Handlers BEFORE createOffer, per the documented pattern.
      connection.addTransceiver("video", { direction: "recvonly" })
      connection.addTransceiver("audio", { direction: "recvonly" })
      connection.addEventListener("track", (event) => {
        options.videoEl.srcObject = event.streams[0] ?? null
      })
      const offer = await connection.createOffer()
      await connection.setLocalDescription(offer)
      await waitForIceGathering(connection)
      if (stopped) return
      const answer = await options.signaling(connection.localDescription?.sdp ?? offer.sdp ?? "")
      sessionUrl = answer.sessionUrl
      await connection.setRemoteDescription({ type: "answer", sdp: answer.sdpAnswer })
      watchForStall(connection)
    },
    async stop() {
      stopped = true
      await teardown()
    },
    sessionUrl: () => sessionUrl,
  }
}
