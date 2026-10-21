import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createStreamRegistry } from "./stream-sessions"

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("createStreamRegistry", () => {
  it("stops the Ring session on explicit end, once", async () => {
    const stop = vi.fn(async () => {})
    const registry = createStreamRegistry({ stop })
    const session = registry.start({ deviceId: "d", ringSessionUrl: "https://ring/s1", capMs: 30_000 })
    expect(registry.get(session.id)?.deviceId).toBe("d")
    expect(await registry.end(session.id)).toBe(true)
    expect(await registry.end(session.id)).toBe(false)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it("stops a session the browser abandoned shortly after the cap", async () => {
    const stop = vi.fn(async () => {})
    const registry = createStreamRegistry({ stop, graceMs: 1_000 })
    const session = registry.start({ deviceId: "d", ringSessionUrl: "https://ring/s2", capMs: 30_000 })
    await vi.advanceTimersByTimeAsync(30_500)
    expect(stop).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(600)
    expect(stop).toHaveBeenCalledWith("https://ring/s2")
    expect(registry.get(session.id)).toBeUndefined()
  })

  it("reports stop failures without throwing", async () => {
    const onStopError = vi.fn()
    const registry = createStreamRegistry({ stop: async () => Promise.reject(new Error("503")), onStopError })
    const session = registry.start({ deviceId: "d", ringSessionUrl: "u", capMs: 1 })
    expect(await registry.end(session.id)).toBe(true)
    expect(onStopError).toHaveBeenCalledTimes(1)
  })
})
