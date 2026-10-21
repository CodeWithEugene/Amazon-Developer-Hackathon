import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"

export interface Session {
  readonly server: McpServer
  readonly transport: StreamableHTTPServerTransport
  /** Digest of the credential that created the session; later requests must match. */
  readonly sessionKey: string
  readonly lastSeenMs: number
}

export interface SessionLimits {
  readonly maxSessions: number
  readonly idleMs: number
}

export const DEFAULT_SESSION_LIMITS: SessionLimits = { maxSessions: 100, idleMs: 30 * 60 * 1000 }

/**
 * Bounded stateful session table: idle sessions expire, and when the table
 * is full the least recently used session is closed to make room.
 */
export class SessionRegistry {
  private readonly sessions = new Map<string, Session>()

  constructor(
    private readonly limits: SessionLimits = DEFAULT_SESSION_LIMITS,
    private readonly clock: () => number = Date.now,
  ) {}

  get size(): number {
    return this.sessions.size
  }

  get(id: string): Session | undefined {
    const session = this.sessions.get(id)
    if (!session) return undefined
    const touched = { ...session, lastSeenMs: this.clock() }
    this.sessions.set(id, touched)
    return touched
  }

  async add(id: string, session: Omit<Session, "lastSeenMs">): Promise<void> {
    await this.sweep()
    while (this.sessions.size >= this.limits.maxSessions) {
      const oldest = [...this.sessions.entries()].sort((a, b) => a[1].lastSeenMs - b[1].lastSeenMs)[0]
      if (!oldest) break
      await this.close(oldest[0])
    }
    this.sessions.set(id, { ...session, lastSeenMs: this.clock() })
  }

  remove(id: string, transport: StreamableHTTPServerTransport): void {
    if (this.sessions.get(id)?.transport === transport) this.sessions.delete(id)
  }

  async sweep(): Promise<void> {
    const cutoff = this.clock() - this.limits.idleMs
    const expired = [...this.sessions.entries()].filter(([, session]) => session.lastSeenMs < cutoff)
    for (const [id] of expired) await this.close(id)
  }

  async closeAll(): Promise<void> {
    for (const id of [...this.sessions.keys()]) await this.close(id)
  }

  private async close(id: string): Promise<void> {
    const session = this.sessions.get(id)
    this.sessions.delete(id)
    if (session) await session.transport.close()
  }
}
