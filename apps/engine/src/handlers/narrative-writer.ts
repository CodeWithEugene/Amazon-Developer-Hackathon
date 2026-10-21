/**
 * Narrative writer. Fills plain-language visit narratives in a separate step
 * after status settles. The template path is fully local and deterministic;
 * with MODEL_PROVIDER=bedrock the injected narrator calls Bedrock Nova and
 * falls back to the template when the model output fails the rules. Times
 * render in the agency time zone (contract C1).
 */
import { validateNarrative } from "@visitproof/domain"

import { timeZoneFor } from "../lib/agency"
import { templateNarrator } from "../lib/defaults"
import { consoleLogger, type EngineDeps } from "../lib/ports"

export const handlerName = "narrative-writer"

export function createNarrativeWriter(deps: EngineDeps) {
  const narrator = deps.narrator ?? templateNarrator
  const logger = deps.logger ?? consoleLogger
  return async function narrativeWriter(
    input: { visitIds?: string[] } = {}
  ): Promise<void> {
    const all = await deps.visits.listAll()
    const narratable = all.filter(
      (visit) =>
        visit.arrival ||
        visit.status === "no_show" ||
        visit.observability.state === "unobservable"
    )
    const visits = input.visitIds
      ? narratable.filter((visit) => input.visitIds?.includes(visit.id))
      : narratable
    for (const visit of visits) {
      if (visit.narrative) continue
      const timeZone = await timeZoneFor(deps, visit.agencyId)
      const narrative = await narrator.write({
        visit,
        now: deps.clock.now(),
        timeZone,
      })
      const rules = validateNarrative(narrative.text, visit, undefined, {
        timeZone,
      })
      if (
        !rules.mustContainTimes ||
        !rules.under60Words ||
        !rules.noOtherNames
      ) {
        // The gate is enforced, not advisory: a non-compliant narrative is
        // never saved — the visit keeps `narrative` unset so the failure is
        // visible (and retried) instead of shipping bad text to families.
        logger.warn(`[narrative-writer] skipping non-compliant narrative`, {
          visitId: visit.id,
          ...rules,
        })
        continue
      }
      await deps.narratives.save(visit.id, narrative)
    }
  }
}
