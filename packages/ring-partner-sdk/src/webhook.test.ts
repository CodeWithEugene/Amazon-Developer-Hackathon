import { createHmac } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  createReplayGuard,
  dedupeKey,
  extractDeviceId,
  parseWebhook,
  parseWebhookLenient,
  safeParseWebhook,
  signWebhookBody,
  verifyWebhookSignature,
} from "./webhook"

const KEY = "test-signing-key"
const envelope = {
  meta: {
    version: "1.1",
    time: "2026-02-13T13:39:57.200Z",
    request_id: "2ad45ade-0000-4000-8000-000000000000",
    account_id: "ava1.ring.account.XXX",
  },
  data: {
    id: "dev1_motion_1786715596787",
    type: "motion_detected",
    attributes: {
      source: "dev1",
      source_type: "devices",
      timestamp: 1786715596787,
      timestamp_readable: "2026-08-14 08:53:16",
      sub_type: "human",
      component_ids: ["0"],
    },
    relationships: { devices: { links: { self: "/v1/devices/dev1" } } },
  },
}
const rawBody = new TextEncoder().encode(JSON.stringify(envelope))
const header = `sha256=${createHmac("sha256", KEY).update(rawBody).digest("hex")}`

describe("verifyWebhookSignature", () => {
  it("accepts a correctly signed body", () => {
    expect(verifyWebhookSignature(rawBody, header, KEY)).toBe(true)
  })

  it("agrees with signWebhookBody and tolerates an uppercase prefix", () => {
    expect(signWebhookBody(rawBody, KEY)).toBe(header)
    expect(verifyWebhookSignature(rawBody, header.replace("sha256", "SHA256"), KEY)).toBe(true)
  })

  it("rejects a tampered body", () => {
    const tampered = new TextEncoder().encode(
      JSON.stringify({ ...envelope, data: { ...envelope.data, id: "dev1_motion_1" } })
    )
    expect(verifyWebhookSignature(tampered, header, KEY)).toBe(false)
  })

  it("rejects the wrong key", () => {
    expect(verifyWebhookSignature(rawBody, header, "other-key")).toBe(false)
  })

  it("rejects a missing, empty, or malformed header", () => {
    expect(verifyWebhookSignature(rawBody, null, KEY)).toBe(false)
    expect(verifyWebhookSignature(rawBody, undefined, KEY)).toBe(false)
    expect(verifyWebhookSignature(rawBody, "", KEY)).toBe(false)
    expect(verifyWebhookSignature(rawBody, "md5=abcd", KEY)).toBe(false)
    expect(verifyWebhookSignature(rawBody, "sha256=zz", KEY)).toBe(false)
    expect(verifyWebhookSignature(rawBody, "sha256=abc", KEY)).toBe(false)
  })

  it("rejects an empty key", () => {
    expect(verifyWebhookSignature(rawBody, header, "")).toBe(false)
  })
})

describe("parseWebhook", () => {
  it("returns the discriminated envelope", () => {
    const parsed = parseWebhook(rawBody)
    expect(parsed.data.type).toBe("motion_detected")
    expect(extractDeviceId(parsed)).toBe("dev1")
    expect(dedupeKey(parsed)).toBe(envelope.meta.request_id)
  })

  it("reports non-JSON and schema failures without throwing", () => {
    expect(safeParseWebhook("not json").ok).toBe(false)
    const result = safeParseWebhook(JSON.stringify({ meta: envelope.meta, data: {} }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.issues.length).toBeGreaterThan(0)
    expect(() => parseWebhook("{}")).toThrow(/envelope/)
  })

  it("falls back to the relationship link for account-scoped events", () => {
    const parsed = parseWebhook(
      JSON.stringify({
        meta: envelope.meta,
        data: {
          id: "x",
          type: "app_integration_removed",
          attributes: { source: "acct", source_type: "accounts", timestamp: 1 },
          relationships: { devices: { links: { self: "/v1/devices/devZ?x=1" } } },
        },
      })
    )
    expect(extractDeviceId(parsed)).toBe("devZ")
  })
})

describe("createReplayGuard", () => {
  it("flags the second delivery of the same request id", () => {
    const guard = createReplayGuard()
    const key = dedupeKey(parseWebhook(rawBody))
    expect(guard.seen(key)).toBe(false)
    expect(guard.seen(key)).toBe(true)
    expect(guard.size()).toBe(1)
  })

  it("evicts the oldest key when full", () => {
    const guard = createReplayGuard(2)
    guard.seen("a")
    guard.seen("b")
    guard.seen("c")
    expect(guard.seen("a")).toBe(false)
    expect(guard.size()).toBe(2)
  })
})

describe("parseWebhookLenient", () => {
  const body = (data: Record<string, unknown>) => JSON.stringify({ meta: envelope.meta, data })

  it("parses known families strictly", () => {
    const result = parseWebhookLenient(rawBody)
    expect(result.ok && result.kind).toBe("known")
  })

  it("keeps an unknown motion sub_type on the known path", () => {
    const result = parseWebhookLenient(
      body({ ...envelope.data, attributes: { ...envelope.data.attributes, sub_type: "package" } })
    )
    expect(result.ok && result.kind).toBe("known")
    if (result.ok && result.kind === "known" && result.envelope.data.type === "motion_detected") {
      expect(result.envelope.data.attributes.sub_type).toBe("package")
    }
  })

  it("returns an unknown data.type with its raw type instead of failing", () => {
    const result = parseWebhookLenient(
      body({
        id: "dev1_glass_break_1",
        type: "glass_break_detected",
        attributes: { source: "dev1", source_type: "devices", timestamp: 5 },
      })
    )
    expect(result.ok).toBe(true)
    if (result.ok && result.kind === "unknown") {
      expect(result.rawType).toBe("glass_break_detected")
      expect(extractDeviceId(result.envelope)).toBe("dev1")
      expect(dedupeKey(result.envelope)).toBe(envelope.meta.request_id)
      expect(result.issues.length).toBeGreaterThan(0)
    } else {
      throw new Error("expected the unknown kind")
    }
  })

  it("fails only without JSON or without the routing ids", () => {
    expect(parseWebhookLenient("nope").ok).toBe(false)
    expect(parseWebhookLenient(JSON.stringify({ meta: {}, data: { type: "x" } })).ok).toBe(false)
  })
})
