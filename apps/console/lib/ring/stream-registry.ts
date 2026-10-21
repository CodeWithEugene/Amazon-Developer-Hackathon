import "server-only"

import type { RingClient } from "@visitproof/ring-partner-sdk"

import { createStreamRegistry, type StreamRegistry } from "./stream-sessions"

/**
 * One registry per server process (kept on globalThis so dev reloads do not
 * orphan sessions). Each session remembers the client that started it, so
 * the stop call uses the same credentials.
 */

const KEY = Symbol.for("visitproof.console.ringStreams")

interface Holder {
  registry: StreamRegistry
  clients: Map<string, RingClient>
}

const holder = (): Holder => {
  const scope = globalThis as { [KEY]?: Holder }
  if (!scope[KEY]) {
    const clients = new Map<string, RingClient>()
    const registry = createStreamRegistry({
      stop: async (ringSessionUrl) => {
        const client = clients.get(ringSessionUrl)
        clients.delete(ringSessionUrl)
        if (client) await client.whepStop(ringSessionUrl)
      },
      onStopError: (error, session) =>
        process.stderr.write(
          `${JSON.stringify({ level: "error", service: "console", message: "whep stop failed", sessionId: session.id, error: String(error) })}\n`
        ),
    })
    scope[KEY] = { registry, clients }
  }
  return scope[KEY]
}

/** The registry; pass the client when starting so stop can reuse it. */
export const getStreamRegistry = (client?: RingClient): StreamRegistry => {
  const { registry, clients } = holder()
  if (!client) return registry
  return {
    ...registry,
    start: (input) => {
      clients.set(input.ringSessionUrl, client)
      return registry.start(input)
    },
  }
}
