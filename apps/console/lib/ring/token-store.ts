import { existsSync, readFileSync } from "node:fs"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import { z } from "zod"

import { withFileLock } from "./file-lock"

/**
 * Durable store for Ring OAuth tokens, always encrypted by a `TokenCipher`
 * before they reach this module. UNCLAIMED tokens (after token exchange,
 * before the Account Link visit) expire after 15 minutes; linked
 * integrations are keyed by client. The local implementation is one JSON
 * file written atomically under a cross-process lock; production maps the
 * same interface onto the RingIntegration and UnclaimedToken items.
 */

export const unclaimedTokenSchema = z.object({
  accountId: z.string().min(1),
  email: z.string().optional(),
  encryptedTokens: z.string().min(1),
  obtainedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
})
export type UnclaimedToken = z.infer<typeof unclaimedTokenSchema>

export const linkedIntegrationSchema = z.object({
  clientId: z.string().min(1),
  accountId: z.string().min(1),
  email: z.string().optional(),
  encryptedTokens: z.string().min(1),
  obtainedAt: z.number().int().nonnegative(),
  integrationStatus: z.string().min(1),
  linkedAt: z.string().min(1),
  updatedAt: z.string().min(1),
})
export type LinkedIntegration = z.infer<typeof linkedIntegrationSchema>

const fileSchema = z.object({
  version: z.literal(1),
  unclaimed: z.array(unclaimedTokenSchema),
  linked: z.array(linkedIntegrationSchema),
})
type TokenFile = z.infer<typeof fileSchema>

const EMPTY: TokenFile = { version: 1, unclaimed: [], linked: [] }

export interface RingTokenStore {
  /** Replaces any UNCLAIMED record for the same account. */
  putUnclaimed(record: UnclaimedToken): Promise<void>
  /** UNCLAIMED records that have not expired at `nowMs`. */
  listUnclaimed(nowMs: number): Promise<UnclaimedToken[]>
  /** Removes and returns the account's UNCLAIMED record (single use). */
  takeUnclaimed(accountId: string, nowMs: number): Promise<UnclaimedToken | null>
  putLinked(record: LinkedIntegration): Promise<void>
  getLinked(clientId: string): Promise<LinkedIntegration | null>
  listLinked(): Promise<LinkedIntegration[]>
  /** Synchronous check used by `getRingMode()`. */
  hasLinkedSync(): boolean
}

const parseFile = (raw: string): TokenFile => fileSchema.parse(JSON.parse(raw))

export const createFileTokenStore = (filePath: string): RingTokenStore => {
  const lockDir = `${filePath}.lock`

  const read = async (): Promise<TokenFile> => {
    if (!existsSync(filePath)) return EMPTY
    return parseFile(await readFile(filePath, "utf8"))
  }

  const update = (change: (file: TokenFile) => TokenFile) =>
    withFileLock(lockDir, async () => {
      const next = change(await read())
      await mkdir(dirname(filePath), { recursive: true })
      const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`
      await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
      await rename(temp, filePath)
    })

  return {
    putUnclaimed: (record) =>
      update((file) => ({
        ...file,
        unclaimed: [...file.unclaimed.filter((entry) => entry.accountId !== record.accountId), record],
      })),
    listUnclaimed: async (nowMs) => (await read()).unclaimed.filter((entry) => entry.expiresAt > nowMs),
    takeUnclaimed: async (accountId, nowMs) => {
      let taken: UnclaimedToken | null = null
      await update((file) => {
        taken = file.unclaimed.find((entry) => entry.accountId === accountId && entry.expiresAt > nowMs) ?? null
        // Expired records are dropped on every write.
        return { ...file, unclaimed: file.unclaimed.filter((entry) => entry.accountId !== accountId && entry.expiresAt > nowMs) }
      })
      return taken
    },
    putLinked: (record) =>
      update((file) => ({
        ...file,
        linked: [...file.linked.filter((entry) => entry.clientId !== record.clientId), record],
      })),
    getLinked: async (clientId) => (await read()).linked.find((entry) => entry.clientId === clientId) ?? null,
    listLinked: async () => (await read()).linked,
    hasLinkedSync: () => {
      if (!existsSync(filePath)) return false
      return parseFile(readFileSync(filePath, "utf8")).linked.length > 0
    },
  }
}

/** In-memory store for tests. */
export const createMemoryTokenStore = (): RingTokenStore => {
  let file: TokenFile = EMPTY
  return {
    putUnclaimed: async (record) => {
      file = { ...file, unclaimed: [...file.unclaimed.filter((e) => e.accountId !== record.accountId), record] }
    },
    listUnclaimed: async (nowMs) => file.unclaimed.filter((entry) => entry.expiresAt > nowMs),
    takeUnclaimed: async (accountId, nowMs) => {
      const taken = file.unclaimed.find((e) => e.accountId === accountId && e.expiresAt > nowMs) ?? null
      file = { ...file, unclaimed: file.unclaimed.filter((e) => e.accountId !== accountId && e.expiresAt > nowMs) }
      return taken
    },
    putLinked: async (record) => {
      file = { ...file, linked: [...file.linked.filter((e) => e.clientId !== record.clientId), record] }
    },
    getLinked: async (clientId) => file.linked.find((entry) => entry.clientId === clientId) ?? null,
    listLinked: async () => file.linked,
    hasLinkedSync: () => file.linked.length > 0,
  }
}
