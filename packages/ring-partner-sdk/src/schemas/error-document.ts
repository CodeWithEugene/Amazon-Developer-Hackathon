import { z } from "zod"

/** JSON:API error document. */

export const errorObjectSchema = z.looseObject({
  status: z.union([z.string(), z.number()]).optional(),
  code: z.string().optional(),
  title: z.string().optional(),
  detail: z.string().optional(),
  source: z
    .looseObject({
      pointer: z.string().optional(),
      parameter: z.string().optional(),
    })
    .optional(),
})
export type ErrorObject = z.infer<typeof errorObjectSchema>

export const errorDocumentSchema = z.looseObject({
  errors: z.array(errorObjectSchema).min(1),
})
export type ErrorDocument = z.infer<typeof errorDocumentSchema>
