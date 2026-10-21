import { describe, expect, it } from "vitest"

import { REDACTED, redactFixture } from "./redact"

describe("redactFixture", () => {
  it("strips personal fields and tokens at any depth, immutably", () => {
    const input = {
      data: {
        id: "user1",
        attributes: {
          first_name: "Priya",
          last_name: "Okoro",
          email: "priya@example.com",
          phone_number: "+15551234567",
          account_id: "ava1.ring.account.X",
        },
      },
      included: [{ access_token: "at", refresh_token: "rt", id_token: "it", nested: { authorization: "Bearer x" } }],
    }
    const out = redactFixture(input) as typeof input
    expect(out.data.attributes).toEqual({
      first_name: REDACTED,
      last_name: REDACTED,
      email: REDACTED,
      phone_number: REDACTED,
      account_id: "ava1.ring.account.X",
    })
    expect(out.included[0]).toEqual({
      access_token: REDACTED,
      refresh_token: REDACTED,
      id_token: REDACTED,
      nested: { authorization: REDACTED },
    })
    expect(input.data.attributes.email).toBe("priya@example.com")
  })

  it("scrubs bearer strings and presigned URL signatures inside values", () => {
    const out = redactFixture({
      note: "Bearer abc.def.ghi",
      url: "https://media.test/f.jpg?X-Amz-Signature=deadbeef&X-Amz-Credential=k",
      plain: "https://api.amazonvision.com/v1/devices/d1",
    }) as Record<string, string>
    expect(out.note).toBe(REDACTED)
    expect(out.url).toBe("https://media.test/f.jpg?[redacted]")
    expect(out.plain).toBe("https://api.amazonvision.com/v1/devices/d1")
  })

  it("keeps non-object values", () => {
    expect(redactFixture([1, true, null, "x"])).toEqual([1, true, null, "x"])
  })
})
