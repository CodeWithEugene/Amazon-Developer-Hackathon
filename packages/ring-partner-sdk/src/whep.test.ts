import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createWhepPeer, type WhepPeerOptions } from "./whep"
import { WHEP_BATTERY_CAP_MS, WHEP_WIRED_CAP_MS } from "./types"

class FakePeerConnection {
  iceGatheringState: RTCIceGatheringState = "complete"
  localDescription: { sdp: string } | null = null
  closed = false
  transceivers: string[] = []
  private listeners = new Map<string, (event: unknown) => void>()
  addTransceiver(kind: string, init: { direction: string }) {
    this.transceivers.push(`${kind}:${init.direction}`)
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
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
    return new Map()
  }
  close() {
    this.closed = true
  }
  fire(type: string, event: unknown) {
    this.listeners.get(type)?.(event)
  }
}

class FakeWindow {
  private listeners = new Map<string, () => void>()
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener)
  }
  removeEventListener(type: string) {
    this.listeners.delete(type)
  }
  has(type: string) {
    return this.listeners.has(type)
  }
  fire(type: string) {
    this.listeners.get(type)?.()
  }
}

const setup = (overrides: Partial<WhepPeerOptions> = {}) => {
  const pcs: FakePeerConnection[] = []
  const win = new FakeWindow()
  const teardown = vi.fn(async () => {})
  const keepaliveTeardown = vi.fn()
  const signaling = vi.fn(async () => ({ sdpAnswer: "v=0 answer", sessionUrl: "/api/ring/stream?id=s1" }))
  const peer = createWhepPeer({
    videoEl: { srcObject: null },
    signaling,
    teardown,
    keepaliveTeardown,
    unloadTarget: win,
    createPeerConnection: () => {
      const pc = new FakePeerConnection()
      pcs.push(pc)
      return pc as unknown as RTCPeerConnection
    },
    ...overrides,
  })
  return { peer, pcs, win, teardown, keepaliveTeardown, signaling }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("createWhepPeer", () => {
  it("negotiates recvonly video and audio and registers an unload keepalive DELETE", async () => {
    const { peer, pcs, win, keepaliveTeardown } = setup()
    await peer.start()
    expect(pcs[0]?.transceivers).toEqual(["video:recvonly", "audio:recvonly"])
    expect(peer.sessionUrl()).toBe("/api/ring/stream?id=s1")
    expect(win.has("pagehide")).toBe(true)
    win.fire("pagehide")
    expect(keepaliveTeardown).toHaveBeenCalledWith("/api/ring/stream?id=s1")
    expect(pcs[0]?.closed).toBe(true)
  })

  it("auto stops at the 30 s battery cap with a countdown", async () => {
    const onCountdown = vi.fn()
    const onEnded = vi.fn()
    const { peer, teardown } = setup({ onCountdown, onEnded })
    await peer.start()
    expect(onCountdown).toHaveBeenCalledWith({ remainingMs: WHEP_BATTERY_CAP_MS, totalMs: WHEP_BATTERY_CAP_MS })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(onCountdown).toHaveBeenLastCalledWith(
      expect.objectContaining({ remainingMs: WHEP_BATTERY_CAP_MS - 10_000 })
    )
    await vi.advanceTimersByTimeAsync(20_000)
    expect(teardown).toHaveBeenCalledWith("/api/ring/stream?id=s1")
    expect(onEnded).toHaveBeenCalledWith("cap")
    expect(peer.sessionUrl()).toBeUndefined()
  })

  it("still reports the cap when the teardown DELETE fails", async () => {
    const onEnded = vi.fn()
    const teardown = vi.fn(async () => {
      throw new Error("Stop failed with 500")
    })
    const { peer } = setup({ onEnded, teardown })
    await peer.start()
    await vi.advanceTimersByTimeAsync(WHEP_BATTERY_CAP_MS)
    expect(teardown).toHaveBeenCalledOnce()
    expect(onEnded).toHaveBeenCalledExactlyOnceWith("cap")
  })

  it("stop() reports the end and rethrows when the teardown DELETE fails", async () => {
    const onEnded = vi.fn()
    const teardown = vi.fn(async () => {
      throw new Error("Stop failed with 403")
    })
    const { peer } = setup({ onEnded, teardown })
    await peer.start()
    await expect(peer.stop()).rejects.toThrow("403")
    expect(onEnded).toHaveBeenCalledExactlyOnceWith("stopped")
  })

  it("uses the 60 s cap for wired devices", async () => {
    const onEnded = vi.fn()
    const { peer } = setup({ batteryPowered: false, onEnded })
    await peer.start()
    await vi.advanceTimersByTimeAsync(WHEP_BATTERY_CAP_MS + 1_000)
    expect(onEnded).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(WHEP_WIRED_CAP_MS - WHEP_BATTERY_CAP_MS)
    expect(onEnded).toHaveBeenCalledWith("cap")
  })

  it("deletes a session created while stop() was racing signaling", async () => {
    let release: (() => void) | undefined
    const signaling = vi.fn(
      () =>
        new Promise<{ sdpAnswer: string; sessionUrl: string }>((resolve) => {
          release = () => resolve({ sdpAnswer: "v=0 answer", sessionUrl: "/api/ring/stream?id=late" })
        })
    )
    const { peer, teardown, win } = setup({ signaling })
    const starting = peer.start()
    await vi.advanceTimersByTimeAsync(0)
    await peer.stop()
    release?.()
    await starting
    expect(teardown).toHaveBeenCalledWith("/api/ring/stream?id=late")
    expect(peer.sessionUrl()).toBeUndefined()
    expect(win.has("pagehide")).toBe(false)
  })

  it("stop() tears down once and removes the unload listener", async () => {
    const { peer, teardown, win } = setup()
    await peer.start()
    await peer.stop()
    await peer.stop()
    expect(teardown).toHaveBeenCalledTimes(1)
    expect(win.has("pagehide")).toBe(false)
  })

  it("requires a browser when no peer factory is injected", () => {
    expect(() =>
      createWhepPeer({ videoEl: { srcObject: null }, signaling: async () => ({ sdpAnswer: "", sessionUrl: "" }) })
    ).toThrow(/browser/)
  })
})
