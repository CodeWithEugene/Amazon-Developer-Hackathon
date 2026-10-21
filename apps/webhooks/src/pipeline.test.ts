import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createLocalRepository } from "@visitproof/db"
import { RingEmulator, withRedeliveries } from "@visitproof/ring-partner-sdk"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "./index"

/**
 * Emulator to receiver to store (build.md Section 11): every signed
 * two-week delivery is accepted over the real Hono app, labeled emulated in
 * demo mode, deduped on redelivery, and persisted per client exactly as the
 * emulator planned it.
 */
describe("emulator to receiver pipeline", () => {
  it("accepts the whole two-week replay with dedupe and provenance", async () => {
    const key = "pipeline-key"
    const repo = createLocalRepository(await mkdtemp(join(tmpdir(), "visitproof-pipeline-")))
    const replay = new RingEmulator({ signingKey: key }).twoWeeks({ startAt: Date.UTC(2026, 8, 15) })
    for (const client of replay.clients) await repo.ringLinks.link(client.clientId, client.accountId, new Date())
    const onEvent = vi.fn()
    const app = createApp({ repository: repo, signingKey: key, mode: "demo", engineInline: false, onEvent })

    let accepted = 0
    let duplicates = 0
    for (const delivery of withRedeliveries(replay.deliveries, { rate: 0.04, seed: "pipeline" })) {
      const res = await app.request(
        new Request("http://localhost/webhooks/ring", {
          method: "POST",
          headers: delivery.headers,
          body: delivery.rawBody.slice().buffer,
        })
      )
      expect(res.status).toBe(202)
      const body = (await res.json()) as { duplicate?: boolean }
      if (body.duplicate) duplicates += 1
      else accepted += 1
    }

    expect(accepted).toBe(replay.deliveries.length)
    expect(duplicates).toBeGreaterThan(0)
    expect(onEvent).not.toHaveBeenCalled()
    for (const client of replay.clients) {
      const stored = await repo.events.byClient(client.clientId)
      const planned = replay.visits.filter((v) => v.clientId === client.clientId).flatMap((v) => v.events)
      expect(stored).toHaveLength(planned.length)
      expect(new Set(stored.map((event) => event.provenance))).toEqual(new Set(["emulated"]))
    }
  }, 60_000)
})
