import type { Caregiver, Visit } from "@visitproof/domain"

/** Door presence was observed but no EVV clock-in matched. */
export const isMissingClockInWithDoor = (visit: Visit): boolean =>
  visit.reconciliation?.outcome === "missing_clock_in" && !!visit.arrival

/**
 * Picks the demo caregiver: most "missing clock-in with door presence"
 * visits, then most visits, then roster order. Pure and deterministic.
 */
export function pickCaregiverPersona(
  visits: readonly Visit[],
  caregivers: readonly Caregiver[]
): string | undefined {
  const score = (caregiverId: string): [number, number] => {
    const mine = visits.filter((v) => v.caregiverId === caregiverId)
    return [mine.filter(isMissingClockInWithDoor).length, mine.length]
  }
  const ranked = caregivers
    .map((caregiver, index) => ({ id: caregiver.id, index, score: score(caregiver.id) }))
    .sort(
      (a, b) =>
        b.score[0] - a.score[0] || b.score[1] - a.score[1] || a.index - b.index
    )
  return ranked[0]?.id
}
