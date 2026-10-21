/**
 * Deterministic seeded randomness for the emulator: the same seed always
 * yields the same schedule, so demo runs and tests are reproducible.
 */

/** FNV-1a 32-bit hash of a string (seed material). */
export const hashSeed = (value: string): number => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export type Rng = () => number

/** Mulberry32: small, fast, good enough for jitter. Returns [0, 1). */
export const createRng = (seed: string): Rng => {
  let state = hashSeed(seed)
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** A whole-second offset in [minMin, maxMin] minutes, as milliseconds. */
export const jitterMs = (rng: Rng, minMin: number, maxMin: number): number => {
  const spanSec = Math.round((maxMin - minMin) * 60)
  return (Math.round(minMin * 60) + Math.floor(rng() * (spanSec + 1))) * 1_000
}
