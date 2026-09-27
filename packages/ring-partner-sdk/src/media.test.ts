import { describe, expect, it } from "vitest"

import {
  cropWatermarkBand,
  snapshotRequestAfterEvent,
  snapshotRequestSchema,
} from "./media"

describe("cropWatermarkBand", () => {
  it("removes the top 15% rows of an RGBA frame without mutating the input", () => {
    const width = 4
    const height = 20
    const data = Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => i % 256)
    const original = Uint8ClampedArray.from(data)

    const cropped = cropWatermarkBand({ width, height, data })

    expect(cropped.removedRows).toBe(3)
    expect(cropped.height).toBe(17)
    expect(cropped.width).toBe(4)
    expect(cropped.channels).toBe(4)
    expect(cropped.data.length).toBe(4 * 17 * 4)
    expect(cropped.data[0]).toBe(data[3 * 4 * 4])
    expect(data).toEqual(original)
  })

  it("derives the channel count and keeps at least one row", () => {
    const rgb = cropWatermarkBand({ width: 2, height: 2, data: new Uint8Array(12) }, 0.9)
    expect(rgb.channels).toBe(3)
    expect(rgb.height).toBe(1)
  })

  it("rejects bad geometry and ratios", () => {
    expect(() => cropWatermarkBand({ width: 0, height: 1, data: new Uint8Array(0) })).toThrow(RangeError)
    expect(() => cropWatermarkBand({ width: 2, height: 2, data: new Uint8Array(7) })).toThrow(RangeError)
    expect(() => cropWatermarkBand({ width: 2, height: 2, data: new Uint8Array(16) }, 1)).toThrow(RangeError)
  })
})

describe("snapshotRequestAfterEvent", () => {
  it("anchors both request bodies on the event timestamp", () => {
    const plan = snapshotRequestAfterEvent(1_700_000_000_000)

    expect(plan.requestAfterMs).toBe(15_000)
    expect(plan.requestAt).toBe(1_700_000_015_000)
    expect(plan.atTimestamp).toEqual({ type: "at_timestamp", timestamp: 1_700_000_000_000, format: "jpeg" })
    expect(plan.latestInRange).toEqual({
      type: "latest_in_range",
      start_time: 1_700_000_000_000,
      end_time: 1_700_000_020_000,
      format: "jpeg",
    })
    expect(snapshotRequestSchema.safeParse(plan.atTimestamp).success).toBe(true)
    expect(snapshotRequestSchema.safeParse(plan.latestInRange).success).toBe(true)
  })

  it("caps the range at 24 hours and validates the timestamp", () => {
    const plan = snapshotRequestAfterEvent(10, { rangeMs: 48 * 3600 * 1000, format: "png" })
    expect(plan.latestInRange.type === "latest_in_range" && plan.latestInRange.end_time).toBe(10 + 24 * 3600 * 1000)
    expect(() => snapshotRequestAfterEvent(-1)).toThrow(RangeError)
  })
})
