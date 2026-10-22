import { buildNarrative } from "@visitproof/domain"
import { describe, expect, it } from "vitest"

import { displayNarrative } from "@/lib/narrative"

import { TZ, visit } from "./fixtures"

const start = new Date("2026-10-01T12:04:00Z") // 8:04 AM ET
const GENERATED_AT = "2026-10-01T15:00:00.000Z"
const DASHES = /[–—]/

const withNarrative = (text: string, provenance: "template" | "bedrock" = "template") =>
  visit("v1", "c1", "cg1", start, {
    narrative: { text, provenance, generatedAt: GENERATED_AT },
  })

describe("displayNarrative", () => {
  it("returns null when the visit has no narrative", () => {
    expect(displayNarrative(visit("v1", "c1", "cg1", start), TZ)).toBeNull()
  })

  it("re-renders legacy 24-hour UTC template times as agency times with the zone", () => {
    const shown = displayNarrative(
      withNarrative("A caregiver arrived at 12:04, on time (12:04). They left at 14:04."),
      TZ
    )
    expect(shown?.text).toBe(
      "A caregiver arrived at 8:04 AM ET, on time (8:04 AM ET). They left at 10:04 AM ET."
    )
    expect(shown?.provenance).toBe("Written from a template")
    expect(shown?.text).not.toMatch(DASHES)
  })

  it("labels standard time as ET too", () => {
    const winter = visit("v2", "c1", "cg1", new Date("2026-12-01T13:04:00Z"), {
      narrative: { text: "A caregiver arrived at 13:04.", provenance: "template", generatedAt: GENERATED_AT },
    })
    expect(displayNarrative(winter, TZ)?.text).toBe("A caregiver arrived at 8:04 AM ET.")
  })

  it("shows a current template narrative exactly as the domain wrote it", () => {
    const base = visit("v1", "c1", "cg1", start)
    const narrative = buildNarrative({ visit: base, now: new Date(GENERATED_AT), timeZone: TZ })
    const shown = displayNarrative({ ...base, narrative }, TZ)
    expect(shown?.text).toBe(narrative.text)
    expect(shown?.text).toContain("arrived at 8:04 AM ET, on time (8:04 AM ET)")
  })

  it("never rewrites Bedrock text", () => {
    const text = "A caregiver arrived at 8:04 AM ET and stayed for the visit."
    const shown = displayNarrative(withNarrative(text, "bedrock"), TZ)
    expect(shown).toEqual({ text, provenance: "Written by Amazon Bedrock" })
  })
})
