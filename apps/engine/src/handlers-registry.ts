/**
 * Handler names deployed by the EngineStack (docs/build.md Section 7). Each
 * handler lives in its own module under `src/handlers/`.
 */
export const ENGINE_HANDLERS = Object.freeze([
  "event-processor",
  "visit-sweeper",
  "narrative-writer",
  "snapshot-fetcher",
  "exporter",
  "mailer",
] as const)

export type EngineHandlerName = (typeof ENGINE_HANDLERS)[number]
