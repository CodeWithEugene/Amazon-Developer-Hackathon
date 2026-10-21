/**
 * Ring Partner API wire types (docs/research.md Section 2). This module is
 * the shared contract between the SDK, the webhook receiver, the emulator,
 * and the engine; the schemas live in `./schemas/*` by family. JSON:API
 * documents use `z.looseObject` so unknown attributes from the live API are
 * preserved, and value sets Ring may extend are open enums.
 */
export * from "./schemas/open-enum"
export * from "./schemas/webhook"
export * from "./schemas/devices"
export * from "./schemas/history"
export * from "./schemas/account"
export * from "./schemas/media"
export * from "./schemas/error-document"
