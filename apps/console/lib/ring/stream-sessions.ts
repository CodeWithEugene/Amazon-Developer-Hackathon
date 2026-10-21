import { randomUUID } from "node:crypto"

/**
 * Server-side WHEP session registry. The browser only ever sees an opaque
 * id; the Ring session URL stays on the server. Ring never reaps sessions,
 * so each one is also stopped server-side shortly after its cap (30 s
 * battery, 60 s wired) even if the browser vanished without a DELETE.
 */

export interface StreamSession {
  readonly id: string
  readonly deviceId: string
  readonly ringSessionUrl: string
  readonly startedAt: number
  readonly capMs: number
}

export interface StreamRegistry {
  start(input: { deviceId: string; ringSessionUrl: string; capMs: number }): StreamSession
  get(id: string): StreamSession | undefined
  /** Stops the Ring session; resolves false when the id is unknown (already ended). */
  end(id: string): Promise<boolean>
}

export interface StreamRegistryOptions {
  readonly stop: (ringSessionUrl: string) => Promise<void>
  readonly onStopError?: (error: unknown, session: StreamSession) => void
  readonly now?: () => number
  /** Extra time after the cap before the server stops the session itself. */
  readonly graceMs?: number
}

export const createStreamRegistry = (options: StreamRegistryOptions): StreamRegistry => {
  const now = options.now ?? Date.now
  let sessions: ReadonlyMap<string, { session: StreamSession; timer: ReturnType<typeof setTimeout> }> = new Map()

  const end = async (id: string): Promise<boolean> => {
    const entry = sessions.get(id)
    if (!entry) return false
    clearTimeout(entry.timer)
    sessions = new Map([...sessions].filter(([key]) => key !== id))
    try {
      await options.stop(entry.session.ringSessionUrl)
    } catch (error) {
      options.onStopError?.(error, entry.session)
    }
    return true
  }

  return {
    start: (input) => {
      const session: StreamSession = { id: randomUUID(), startedAt: now(), ...input }
      const timer = setTimeout(() => void end(session.id), input.capMs + (options.graceMs ?? 2_000))
      timer.unref?.()
      sessions = new Map([...sessions, [session.id, { session, timer }]])
      return session
    },
    get: (id) => sessions.get(id)?.session,
    end,
  }
}
