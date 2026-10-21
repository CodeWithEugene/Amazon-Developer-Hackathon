import { z } from "zod"

/**
 * Open enums. Ring adds values over time (new motion sub types, sensor
 * names, history event types, integration states), and a validly signed
 * webhook or a history page must never be rejected because of one. An open
 * enum accepts any non-empty string at runtime while keeping the known
 * values for autocompletion and for `isKnownValue` checks.
 */

/** A known literal, or any other string (kept distinct for autocompletion). */
export type Open<T extends string> = T | (string & Record<never, never>)

export const openEnum = <const T extends readonly [string, ...string[]]>(
  known: T
): z.ZodType<Open<T[number]>, string> =>
  z
    .string()
    .min(1)
    .describe(`One of ${known.join(", ")}, or a value Ring added later`) as unknown as z.ZodType<
    Open<T[number]>,
    string
  >

export const isKnownValue = <const T extends readonly string[]>(
  known: T,
  value: string
): value is T[number] => (known as readonly string[]).includes(value)
