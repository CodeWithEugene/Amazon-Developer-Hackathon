import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"

/**
 * Raw archive for validly signed deliveries the receiver cannot map to a
 * `DoorEvent` (a `data.type` Ring added after this build). They are kept
 * with their raw type so they can be reprocessed once the mapping exists,
 * instead of being rejected. Production replaces the file archive with an
 * object store keyed by request id.
 */

export interface RawEventRecord {
  readonly requestId: string
  readonly accountId: string
  readonly rawType: string
  readonly receivedAt: string
  /** The exact signed body, UTF-8. */
  readonly rawBody: string
}

export interface RawEventArchive {
  put(record: RawEventRecord): Promise<void>
}

/** Appends one JSON line per record (O_APPEND, safe across processes). */
export const createFileArchive = (dir: string): RawEventArchive => ({
  put: async (record) => {
    await mkdir(dir, { recursive: true })
    await appendFile(join(dir, "webhook-unknown-events.jsonl"), `${JSON.stringify(record)}\n`, "utf8")
  },
})

/** In-memory archive for tests and as a safe default. */
export const createMemoryArchive = (): RawEventArchive & { readonly records: () => readonly RawEventRecord[] } => {
  let records: readonly RawEventRecord[] = []
  return {
    put: async (record) => {
      records = [...records, record]
    },
    records: () => records,
  }
}
