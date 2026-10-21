import { randomUUID } from "node:crypto"
import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import { MalformedDataError } from "../errors"
import type { Key } from "../keys"
import { toEpochSeconds } from "../time"
import { withFileLock, type FileLockOptions } from "./file-lock"

/**
 * One JSON file per table on disk, safe for several processes sharing the
 * directory (contract C8):
 *
 * - every read checks the file identity (inode, size, mtime) and re-parses
 *   when another process replaced it, so no process serves a stale snapshot;
 * - every write goes to a temp file and is renamed over the table, so readers
 *   never see a half-written file;
 * - every read-modify-write runs under a cross-process lockfile, so two
 *   writers never lose each other's rows.
 */

export type StoredRow<T> = T & { readonly expiresAt?: number }
type Rows<T> = ReadonlyMap<string, StoredRow<T>>

interface Snapshot<T> {
  readonly identity: string
  readonly rows: Rows<T>
}

export interface JsonTableOptions {
  readonly now: () => Date
  /** Validates each stored item on read; throws MalformedDataError on failure. */
  readonly parse?: (item: unknown) => unknown
  readonly lock?: FileLockOptions
}

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined

const EMPTY_IDENTITY = "absent"

export class JsonTable<T> {
  private cache: Snapshot<T> = { identity: EMPTY_IDENTITY, rows: new Map() }

  constructor(
    private readonly filePath: string,
    private readonly options: JsonTableOptions
  ) {}

  private keyOf(key: Key): string {
    return `${key.pk}￿${key.sk}`
  }

  private parseRows(raw: string): Rows<T> {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (cause) {
      throw new MalformedDataError(`${this.filePath} is not valid JSON`, {
        cause,
      })
    }
    if (!Array.isArray(parsed)) {
      throw new MalformedDataError(`${this.filePath} must contain an array`)
    }
    const rows = new Map<string, StoredRow<T>>()
    for (const row of parsed) {
      if (typeof row !== "object" || row === null) {
        throw new MalformedDataError(`${this.filePath} has a malformed row`)
      }
      const { key, item } = row as { key?: unknown; item?: unknown }
      if (
        typeof key !== "string" ||
        typeof item !== "object" ||
        item === null
      ) {
        throw new MalformedDataError(`${this.filePath} has a malformed row`)
      }
      const checked = this.options.parse ? this.options.parse(item) : item
      rows.set(key, checked as StoredRow<T>)
    }
    return rows
  }

  /** Current on-disk rows; re-parsed only when the file changed. */
  private async read(): Promise<Rows<T>> {
    let handle
    try {
      handle = await open(this.filePath, "r")
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error
      this.cache = { identity: EMPTY_IDENTITY, rows: new Map() }
      return this.cache.rows
    }
    try {
      const info = await handle.stat()
      const identity = `${info.ino}:${info.size}:${info.mtimeMs}`
      if (identity !== this.cache.identity) {
        const raw = await handle.readFile("utf8")
        this.cache = { identity, rows: this.parseRows(raw) }
      }
      return this.cache.rows
    } finally {
      await handle.close()
    }
  }

  private live(rows: Rows<T>): Map<string, StoredRow<T>> {
    const cutoff = toEpochSeconds(this.options.now())
    return new Map(
      [...rows].filter(
        ([, item]) => item.expiresAt === undefined || item.expiresAt > cutoff
      )
    )
  }

  private async write(rows: Rows<T>): Promise<void> {
    const serialised = [...rows].map(([key, item]) => ({ key, item }))
    const temp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    await mkdir(dirname(this.filePath), { recursive: true })
    try {
      await writeFile(temp, `${JSON.stringify(serialised, null, 2)}\n`, "utf8")
      await rename(temp, this.filePath)
    } catch (error) {
      await unlink(temp).catch((cleanupError: unknown) => {
        if (errorCode(cleanupError) !== "ENOENT") throw cleanupError
      })
      throw error
    }
  }

  /**
   * Read-modify-write under the table lock. `change` receives the live rows
   * and returns the next rows (or `null` for no write) plus a result.
   */
  private async mutate<R>(
    change: (rows: Map<string, StoredRow<T>>) => {
      next: Rows<T> | null
      result: R
    }
  ): Promise<R> {
    return withFileLock(
      `${this.filePath}.lock`,
      async () => {
        const { next, result } = change(this.live(await this.read()))
        if (next !== null) await this.write(next)
        return result
      },
      this.options.lock
    )
  }

  async get(key: Key): Promise<StoredRow<T> | null> {
    return this.live(await this.read()).get(this.keyOf(key)) ?? null
  }

  async has(key: Key): Promise<boolean> {
    return this.live(await this.read()).has(this.keyOf(key))
  }

  async all(): Promise<StoredRow<T>[]> {
    return [...this.live(await this.read()).values()]
  }

  private stored(item: T, expiresAt?: number): StoredRow<T> {
    return { ...item, ...(expiresAt !== undefined ? { expiresAt } : {}) }
  }

  async put(key: Key, item: T, expiresAt?: number): Promise<void> {
    await this.mutate((rows) => ({
      next: new Map(rows).set(this.keyOf(key), this.stored(item, expiresAt)),
      result: undefined,
    }))
  }

  /** Atomic conditional put; false when the key already exists. */
  async putIfAbsent(key: Key, item: T, expiresAt?: number): Promise<boolean> {
    return this.mutate((rows) => {
      const id = this.keyOf(key)
      if (rows.has(id)) return { next: null, result: false }
      return {
        next: new Map(rows).set(id, this.stored(item, expiresAt)),
        result: true,
      }
    })
  }

  /** Atomic read-modify-write of one row; `null` when the row is absent. */
  async update(
    key: Key,
    change: (current: StoredRow<T>) => T
  ): Promise<T | null> {
    return this.mutate((rows) => {
      const id = this.keyOf(key)
      const current = rows.get(id)
      if (current === undefined) return { next: null, result: null }
      const updated = change(current)
      return {
        next: new Map(rows).set(id, this.stored(updated, current.expiresAt)),
        result: updated,
      }
    })
  }

  async delete(key: Key): Promise<void> {
    await this.mutate((rows) => {
      const id = this.keyOf(key)
      if (!rows.has(id)) return { next: null, result: undefined }
      const next = new Map(rows)
      next.delete(id)
      return { next, result: undefined }
    })
  }

  /** Atomically removes every row matching `predicate`; returns the count. */
  async deleteWhere(
    predicate: (item: StoredRow<T>) => boolean
  ): Promise<number> {
    return this.mutate((rows) => {
      const kept = new Map([...rows].filter(([, item]) => !predicate(item)))
      const removed = rows.size - kept.size
      return { next: removed === 0 ? null : kept, result: removed }
    })
  }
}
