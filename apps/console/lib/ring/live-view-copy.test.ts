import { describe, expect, it } from "vitest"

import { ENDED_TEXT, noVideoNotice } from "./live-view-copy"

describe("noVideoNotice", () => {
  it("tells a Playground user the sandbox only streams during a simulated event", () => {
    const notice = noVideoNotice("playground")
    expect(notice.title).toBe("Connected To Ring, But No Video Arrived")
    expect(notice.description).toMatch(/only streams while a simulated event is running/)
    expect(notice.description).not.toMatch(/only streams video|connection is up/)
    expect(notice.description).toMatch(/Ring Developer Playground/)
    expect(notice.description).toMatch(/does not hold one of Ring's live view slots/)
  })

  it("gives a linked household a doorbell focused explanation", () => {
    const notice = noVideoNotice("linked")
    expect(notice.description).not.toMatch(/Playground/)
    expect(notice.description).toMatch(/no video within 8 seconds/)
    expect(notice.description).toMatch(/the connection was up/)
  })

  it("uses Title Case for the title and no dashes anywhere", () => {
    const notices = [noVideoNotice("playground"), noVideoNotice("linked")]
    for (const notice of notices) {
      expect(notice.title.split(" ").every((word) => /^[A-Z]/.test(word))).toBe(true)
    }
    const text = [...notices.flatMap((notice) => [notice.title, notice.description]), ...Object.values(ENDED_TEXT)].join(" ")
    expect(text).not.toMatch(/[–—]/)
  })
})
