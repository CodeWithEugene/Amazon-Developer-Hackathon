import { DEFAULT_TOLERANCES, type Tolerances } from "@visitproof/domain"

import type { EngineDeps } from "./ports"

/** Demo agency time zone when no agency record is available. */
export const DEFAULT_TIME_ZONE = "America/New_York"

/**
 * The agency's configured tolerances (docs/build.md Section 4), so the
 * engine handlers and the console classify lateness identically. Falls back
 * to DEFAULT_TOLERANCES only when no agency store is wired or the agency is
 * unknown.
 */
export async function tolerancesFor(
  deps: Pick<EngineDeps, "agencies">,
  agencyId: string | undefined
): Promise<Tolerances> {
  if (agencyId === undefined || deps.agencies === undefined)
    return DEFAULT_TOLERANCES
  const agency = await deps.agencies.get(agencyId)
  return agency?.tolerances ?? DEFAULT_TOLERANCES
}

/** The agency time zone (contract C1), defaulting to the demo zone. */
export async function timeZoneFor(
  deps: Pick<EngineDeps, "agencies">,
  agencyId: string | undefined
): Promise<string> {
  if (agencyId === undefined || deps.agencies === undefined)
    return DEFAULT_TIME_ZONE
  const agency = await deps.agencies.get(agencyId)
  return agency?.timezone ?? DEFAULT_TIME_ZONE
}
