import {
  agencySchema,
  caregiverSchema,
  clientSchema,
  doorEventSchema,
  evvRecordSchema,
  exceptionSchema,
  ledgerRecordSchema,
  noteSchema,
  snapshotSchema,
  visitSchema,
} from "@visitproof/domain"
import { z } from "zod"

import { MalformedDataError } from "./errors"

/**
 * Read-side validation at the persistence boundary. Every stored item is
 * checked against its domain schema before it is handed to a caller, so a
 * corrupt or out-of-contract row fails loudly with `MalformedDataError`
 * instead of flowing on as a mistyped value.
 *
 * The parsed result is merged over the stored attributes: schema defaults
 * are applied, and attributes the schema does not know (for example a field
 * another workstream added before the domain schema caught up) survive a
 * read-modify-write instead of being silently stripped.
 */

export const ringAccountRowSchema = z.object({ clientId: z.string().min(1) })
export const webhookReceiptRowSchema = z.object({
  requestId: z.string().min(1),
})

export const ENTITY_SCHEMAS = Object.freeze({
  agency: agencySchema,
  visit: visitSchema,
  event: doorEventSchema,
  exception: exceptionSchema,
  caregiver: caregiverSchema,
  client: clientSchema,
  ringAccount: ringAccountRowSchema,
  evv: evvRecordSchema,
  note: noteSchema,
  snapshot: snapshotSchema,
  ledger: ledgerRecordSchema,
  webhookReceipt: webhookReceiptRowSchema,
})

export type EntityName = keyof typeof ENTITY_SCHEMAS

/** Single-table key columns that are storage detail, never entity data. */
const KEY_COLUMNS = new Set([
  "pk",
  "sk",
  "gsi1pk",
  "gsi1sk",
  "gsi2pk",
  "gsi2sk",
])

const withoutKeyColumns = (
  item: Record<string, unknown>
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(item).filter(([name]) => !KEY_COLUMNS.has(name))
  )

/** Validates one stored item; throws MalformedDataError naming the entity. */
export const parseStored = (
  entity: EntityName,
  item: unknown
): Record<string, unknown> => {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new MalformedDataError(`stored ${entity} is not an object`)
  }
  const attributes = withoutKeyColumns(item as Record<string, unknown>)
  const result = ENTITY_SCHEMAS[entity].safeParse(attributes)
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ")
    throw new MalformedDataError(
      `stored ${entity} failed validation: ${issues}`
    )
  }
  return { ...attributes, ...(result.data as Record<string, unknown>) }
}

/** A parser bound to one entity, or a pass-through when validation is off. */
export const storedParser = (
  entity: EntityName,
  enabled: boolean
): ((item: unknown) => unknown) =>
  enabled ? (item) => parseStored(entity, item) : (item) => item
