/**
 * Narrative writer. Fills plain-language visit narratives in a separate step
 * after status settles. The template path is fully local and deterministic;
 * Bedrock Nova is layered on in production only.
 */
import { buildNarrative, validateNarrative } from "@visitproof/domain"

import type { EngineDeps } from "../lib/ports"

export const handlerName = "narrative-writer"

export function createNarrativeWriter(deps: EngineDeps) {
  return async function narrativeWriter(input: { visitIds?: string[] } = {}): Promise<void> {
    const all = await deps.visits.listAll()
    const narratable = all.filter(
      (visit) =>
        visit.arrival || visit.status === "no_show" || visit.observability.state === "unobservable"
    )
    const visits = input.visitIds
      ? narratable.filter((visit) => input.visitIds?.includes(visit.id))
      : narratable
    for (const visit of visits) {
      if (visit.narrative) continue
      const narrative = buildNarrative({ visit, now: deps.clock.now() })
      const rules = validateNarrative(narrative.text, visit)
      if (!rules.mustContainTimes || !rules.under60Words || !rules.noOtherNames) {
        // The gate is enforced, not advisory: a non-compliant narrative is
        // never saved — the visit keeps `narrative` unset so the failure is
        // visible (and retried) instead of shipping bad text to families.
        console.warn(
          `[narrative-writer] skipping non-compliant narrative for ${visit.id}`,
          rules
        )
        continue
      }
      await deps.narratives.save(visit.id, narrative)
    }
  }
}
