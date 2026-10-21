import { createRng } from "./jitter"

/**
 * Ring delivers at least once and not necessarily in order. This pure helper
 * turns an ordered delivery list into a realistic wire sequence: about
 * `rate` of deliveries are sent twice (identical bytes and request id, so the
 * receiver's dedupe is visible in the log), and a few neighbors swap places.
 * Seeded, so the same input and seed always give the same sequence.
 */
export interface RedeliveryOptions {
  readonly rate?: number
  readonly swapRate?: number
  readonly seed?: string
}

export const withRedeliveries = <T>(deliveries: readonly T[], options: RedeliveryOptions = {}): readonly T[] => {
  const rng = createRng(options.seed ?? "visitproof-redelivery")
  const rate = options.rate ?? 0.03
  const swapRate = options.swapRate ?? 0.02
  const withRetries = deliveries.flatMap((delivery) => (rng() < rate ? [delivery, delivery] : [delivery]))
  return withRetries.reduce<readonly T[]>((acc, delivery, index) => {
    const previous = acc[index - 1]
    if (index === 0 || previous === undefined || previous === delivery || rng() >= swapRate) {
      return [...acc, delivery]
    }
    return [...acc.slice(0, index - 1), delivery, previous]
  }, [])
}
