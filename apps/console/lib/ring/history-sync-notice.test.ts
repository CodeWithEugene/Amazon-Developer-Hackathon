import { describe, expect, it } from "vitest"

import { historySyncNotice, historySyncResponseSchema } from "./history-sync-notice"

const empty = { devices: 1, fetched: 0, saved: 0, alreadyStored: 0 }

describe("historySyncNotice", () => {
  it("says clearly that the Playground doorbell returned no events, as information not an error", () => {
    const notice = historySyncNotice(empty, { source: "playground" })
    expect(notice.type).toBe("info")
    expect(notice.title).toBe("No Ring Events Since Consent")
    expect(notice.description).toMatch(/^Ring returned no events for this device since consent\./)
    expect(notice.description).toMatch(/Playground sandbox doorbell has no recorded motion or doorbell events/)
  })

  it("does not mention the sandbox for a linked account", () => {
    const notice = historySyncNotice(empty, { source: "linked" })
    expect(notice.type).toBe("info")
    expect(notice.description).not.toMatch(/Playground/)
  })

  it("reports saved and already stored counts when events arrived", () => {
    const notice = historySyncNotice({ fetched: 3, saved: 1, alreadyStored: 2 }, { provenance: "Linked Ring account" })
    expect(notice).toEqual({
      type: "success",
      title: "Ring History Synced",
      description: "1 new event saved from Linked Ring account. 2 were already stored.",
    })
  })

  it("uses no dashes in its copy", () => {
    const text = [historySyncNotice(empty, { source: "playground" }), historySyncNotice(empty)]
      .flatMap((notice) => [notice.title, notice.description])
      .join(" ")
    expect(text).not.toMatch(/[–—]/)
  })
})

describe("historySyncResponseSchema", () => {
  it("accepts the route's response and rejects negative counts", () => {
    expect(historySyncResponseSchema.safeParse({ result: empty, source: "playground", provenance: "x" }).success).toBe(true)
    expect(historySyncResponseSchema.safeParse({ result: { ...empty, fetched: -1 } }).success).toBe(false)
  })
})
