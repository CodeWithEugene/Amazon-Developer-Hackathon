import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createWhepPeer } from "./whep"
import {
  classifyVideoProgress,
  EMPTY_INBOUND_SAMPLE,
  NO_VIDEO_TIMEOUT_MS,
  readInboundMedia,
} from "./whep-video"

const stats = (...reports: object[]) => new Map(reports.map((report, index) => [`r${index}`, report]))

describe("readInboundMedia", () => {
  it("reports nothing when the browser has no inbound-rtp stats (the Playground case)", () => {
    expect(readInboundMedia(stats({ type: "transport", bytesReceived: 2_400 }))).toEqual(EMPTY_INBOUND_SAMPLE)
  })

  it("sums decoded video frames and bytes across inbound streams", () => {
    const sample = readInboundMedia(
      stats(
        { type: "inbound-rtp", kind: "video", framesDecoded: 12, bytesReceived: 9_000 },
        { type: "inbound-rtp", kind: "audio", bytesReceived: 500 },
        { type: "inbound-rtp", mediaType: "video", framesDecoded: 3, bytesReceived: 100 }
      )
    )
    expect(sample).toEqual({ framesDecoded: 15, bytesReceived: 9_600, hasInboundVideo: true })
  })

  it("ignores reports with malformed counters", () => {
    expect(readInboundMedia(stats({ type: "inbound-rtp", kind: "video", framesDecoded: "many" }))).toEqual(EMPTY_INBOUND_SAMPLE)
  })
})

describe("classifyVideoProgress", () => {
  const base = { sample: EMPTY_INBOUND_SAMPLE, connectedAt: 1_000 }

  it("waits until the timeout before giving up", () => {
    expect(classifyVideoProgress({ ...base, now: 1_000 + NO_VIDEO_TIMEOUT_MS - 1 })).toBe("waiting")
    expect(classifyVideoProgress({ ...base, now: 1_000 + NO_VIDEO_TIMEOUT_MS })).toBe("no_video")
  })

  it("treats bytes without decoded frames as no video", () => {
    const sample = { framesDecoded: 0, bytesReceived: 2_400, hasInboundVideo: true }
    expect(classifyVideoProgress({ sample, connectedAt: 0, now: 9_000 })).toBe("no_video")
  })

  it("reports flowing as soon as one frame decodes", () => {
    const sample = { framesDecoded: 1, bytesReceived: 800, hasInboundVideo: true }
    expect(classifyVideoProgress({ sample, connectedAt: 0, now: 60_000 })).toBe("flowing")
  })
})

class ConnectingPeer {
  iceGatheringState = "complete"
  connectionState = "new"
  localDescription: { sdp: string } | null = null
  report: Map<string, object> = new Map()
  private listeners = new Map<string, () => void>()
  addTransceiver() {}
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener)
  }
  removeEventListener() {}
  async createOffer() {
    return { type: "offer", sdp: "v=0 offer" }
  }
  async setLocalDescription(description: { sdp: string }) {
    this.localDescription = description
  }
  async setRemoteDescription() {}
  async getStats() {
    return this.report
  }
  close() {}
  connect() {
    this.connectionState = "connected"
    this.listeners.get("connectionstatechange")?.()
  }
}

const setup = (teardownImpl: (url: string) => Promise<void> = async () => {}) => {
  const pc = new ConnectingPeer()
  const teardown = vi.fn(teardownImpl)
  const onEnded = vi.fn()
  const onNoVideo = vi.fn()
  const peer = createWhepPeer({
    videoEl: { srcObject: null },
    signaling: async () => ({ sdpAnswer: "v=0 answer", sessionUrl: "/api/ring/stream?id=s1" }),
    teardown,
    onEnded,
    onNoVideo,
    batteryPowered: false,
    unloadTarget: { addEventListener: () => undefined, removeEventListener: () => undefined },
    createPeerConnection: () => pc as unknown as RTCPeerConnection,
  })
  return { pc, peer, teardown, onEnded, onNoVideo }
}

describe("createWhepPeer no video detection", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("stops the session with DELETE when connected but no frame decodes in 8 s", async () => {
    const { pc, peer, teardown, onEnded, onNoVideo } = setup()
    await peer.start()
    pc.connect()
    await vi.advanceTimersByTimeAsync(NO_VIDEO_TIMEOUT_MS - 1_000)
    expect(teardown).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(onNoVideo).toHaveBeenCalledWith(EMPTY_INBOUND_SAMPLE)
    expect(teardown).toHaveBeenCalledExactlyOnceWith("/api/ring/stream?id=s1")
    expect(onEnded).toHaveBeenCalledExactlyOnceWith("no_video")
  })

  it("still reports no_video when the teardown DELETE fails", async () => {
    const { pc, peer, teardown, onEnded } = setup(async () => {
      throw new Error("Stop failed with 401")
    })
    await peer.start()
    pc.connect()
    await vi.advanceTimersByTimeAsync(NO_VIDEO_TIMEOUT_MS)
    expect(teardown).toHaveBeenCalledOnce()
    expect(onEnded).toHaveBeenCalledExactlyOnceWith("no_video")
    expect(peer.sessionUrl()).toBeUndefined()
  })

  it("keeps streaming once frames decode", async () => {
    const { pc, peer, teardown, onEnded } = setup()
    await peer.start()
    pc.report = stats({ type: "inbound-rtp", kind: "video", framesDecoded: 30, bytesReceived: 40_000 })
    pc.connect()
    await vi.advanceTimersByTimeAsync(NO_VIDEO_TIMEOUT_MS * 2)
    expect(teardown).not.toHaveBeenCalled()
    expect(onEnded).not.toHaveBeenCalled()
  })

  it("does not start the clock before the connection is connected", async () => {
    const { peer, teardown } = setup()
    await peer.start()
    await vi.advanceTimersByTimeAsync(NO_VIDEO_TIMEOUT_MS * 2)
    expect(teardown).not.toHaveBeenCalled()
  })
})
