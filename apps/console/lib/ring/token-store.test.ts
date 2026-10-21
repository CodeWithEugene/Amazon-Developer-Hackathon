import { describe, expect, it } from "vitest"

import { tempFile } from "./testing/fixtures"
import { createFileTokenStore } from "./token-store"

const record = (accountId: string, expiresAt: number) => ({
  accountId,
  encryptedTokens: `sealed-${accountId}`,
  obtainedAt: 0,
  expiresAt,
})

describe("createFileTokenStore", () => {
  it("persists unclaimed and linked records across instances", async () => {
    const path = await tempFile("ring-tokens.json")
    const store = createFileTokenStore(path)
    expect(store.hasLinkedSync()).toBe(false)
    await store.putUnclaimed(record("a", 1_000))
    await store.putUnclaimed(record("b", 10))
    expect((await createFileTokenStore(path).listUnclaimed(100)).map((r) => r.accountId)).toEqual(["a"])
    expect(await store.takeUnclaimed("a", 100)).toMatchObject({ accountId: "a" })
    expect(await store.takeUnclaimed("a", 100)).toBeNull()
    await store.putLinked({
      clientId: "cli_1",
      accountId: "a",
      encryptedTokens: "sealed",
      obtainedAt: 5,
      integrationStatus: "completed",
      linkedAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    })
    expect(createFileTokenStore(path).hasLinkedSync()).toBe(true)
    expect((await store.getLinked("cli_1"))?.accountId).toBe("a")
  })

  it("serializes concurrent writers without losing records", async () => {
    const path = await tempFile("ring-tokens.json")
    const writers = Array.from({ length: 12 }, (_, index) =>
      createFileTokenStore(path).putUnclaimed(record(`acct-${index}`, 10_000))
    )
    await Promise.all(writers)
    expect(await createFileTokenStore(path).listUnclaimed(0)).toHaveLength(12)
  })
})
