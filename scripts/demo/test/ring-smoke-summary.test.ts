import { historyDocumentSchema } from "@visitproof/ring-partner-sdk"
import { PLAYGROUND_FIXTURES } from "@visitproof/ring-partner-sdk/testing"
import { describe, expect, it } from "vitest"

import { historySummary } from "../../ring-smoke-summary"

describe("ring-smoke historySummary", () => {
  it("prints the real page's epoch ms times as ISO 8601", () => {
    const events = historyDocumentSchema.parse(PLAYGROUND_FIXTURES.historyEvents).data
    expect(historySummary(events, false)).toBe(
      `3 events on the first page, types on_demand, ${new Date(1792629883048).toISOString()} to ${new Date(1792629988552).toISOString()}, next page no`
    )
  })

  it("reports an empty page", () => {
    expect(historySummary([], false)).toMatch(/^0 events/)
  })
})
