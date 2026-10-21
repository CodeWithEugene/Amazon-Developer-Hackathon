/** Structured logger port; the default writes one JSON line to stderr. */
export interface WebhookLogger {
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

const write = (level: "warn" | "error", message: string, meta?: Record<string, unknown>): void => {
  process.stderr.write(`${JSON.stringify({ level, service: "webhooks", message, ...meta })}\n`)
}

export const stderrLogger: WebhookLogger = {
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta),
}

export const errorMeta = (error: unknown): Record<string, unknown> =>
  error instanceof Error ? { error: error.message, name: error.name } : { error: String(error) }
