import { describe, expect, it } from "vitest"

import { startOutcome } from "./live-view-state"

describe("startOutcome", () => {
  it("is live when the current peer holds a session", () => {
    expect(startOutcome({ isCurrent: true, sessionUrl: "/api/ring/stream?id=s1" })).toBe("live")
  })

  it("is cancelled when Stop ran before Ring returned a session", () => {
    expect(startOutcome({ isCurrent: true, sessionUrl: undefined })).toBe("cancelled")
  })

  it("is cancelled when the component already let go of the peer", () => {
    expect(startOutcome({ isCurrent: false, sessionUrl: "/api/ring/stream?id=s1" })).toBe("cancelled")
  })
})
