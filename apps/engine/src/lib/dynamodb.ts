/**
 * Minimal DynamoDB attribute-value unmarshalling for stream records.
 * Handles the attribute types VisitProof persists (S, N, BOOL, NULL, L, M).
 */
type AttributeValue =
  | { S: string }
  | { N: string }
  | { BOOL: boolean }
  | { NULL: true }
  | { L: AttributeValue[] }
  | { M: Record<string, AttributeValue> }

export function unmarshalItem(
  item: Record<string, AttributeValue> | undefined
): Record<string, unknown> | null {
  if (!item) return null
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(item)) {
    result[key] = unmarshalValue(value)
  }
  return result
}

function unmarshalValue(value: unknown): unknown {
  if (!isAttributeValue(value)) return value
  const attr = value as AttributeValue
  if ("S" in attr) return attr.S
  if ("N" in attr) return Number(attr.N)
  if ("BOOL" in attr) return attr.BOOL
  if ("NULL" in attr) return null
  if ("L" in attr) return attr.L.map(unmarshalValue)
  if ("M" in attr) {
    const nested: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(attr.M)) {
      nested[key] = unmarshalValue(inner)
    }
    return nested
  }
  return undefined
}

const ATTRIBUTE_KEYS = new Set(["S", "N", "BOOL", "NULL", "L", "M"])

/** True for DynamoDB attribute values; plain JSON passes through unchanged. */
function isAttributeValue(value: unknown): value is AttributeValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return keys.length === 1 && ATTRIBUTE_KEYS.has(keys[0] as string)
}
