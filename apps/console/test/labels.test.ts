import { describe, expect, it } from "vitest"

import {
  exceptionKindSchema,
  reconciliationOutcomeSchema,
  ringLinkStatusSchema,
  visitStatusSchema,
} from "@visitproof/domain"
import { STATUS_BADGES, statusLabel } from "@workspace/ui/components/status-badge"

describe("status badge labels", () => {
  const all = [
    ...visitStatusSchema.options,
    ...exceptionKindSchema.options,
    ...reconciliationOutcomeSchema.options,
    ...ringLinkStatusSchema.options,
  ]

  it.each(all)("has a human label for %s", (status) => {
    expect(Object.keys(STATUS_BADGES)).toContain(status)
    expect(statusLabel(status)).not.toContain("_")
  })

  it("labels late arrivals, scheduled, and in-progress visits", () => {
    expect(statusLabel("late_arrival")).toBe("Late Arrival")
    expect(statusLabel("scheduled")).toBe("Scheduled")
    expect(statusLabel("in_progress")).toBe("In Progress")
  })

  it("title-cases unknown values instead of showing the raw enum", () => {
    expect(statusLabel("device_offline")).toBe("Device Offline")
  })
})
