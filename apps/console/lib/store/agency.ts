import "server-only"

import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { agencySchema, type Agency } from "@visitproof/domain"

import { storeDir } from "./paths"
import { AGENCY_ID, getStore, storeKind } from "./repository"

/** The demo agency, used only when no agency record has been seeded yet. */
export const DEFAULT_AGENCY: Agency = {
  id: AGENCY_ID,
  name: "Caring Hands Home Care",
  state: "OH",
  timezone: "America/New_York",
  tolerances: {
    graceMin: 15,
    escalationMin: 45,
    earlyDepartureMin: 10,
    departureQuietMin: 10,
  },
  retentionDays: 365,
  evvVendor: "State EVV Portal",
  notificationDefaults: { digestHour: 19, exceptionAlerts: true },
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  version: 1,
}

const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "ENOENT"

async function readAgencyFile(): Promise<Agency | null> {
  const path = join(storeDir(), "agency.json")
  let raw: string
  try {
    raw = await readFile(path, "utf8")
  } catch (error) {
    if (isMissingFile(error)) return null
    throw error
  }
  const parsed = agencySchema.safeParse(JSON.parse(raw))
  if (!parsed.success) {
    throw new Error(`${path} is not a valid agency record`, {
      cause: parsed.error,
    })
  }
  return parsed.data
}

/**
 * The agency record. Reads the repository's agency table when it has one,
 * then the demo's `agency.json`; only a missing record falls back to the
 * default. Malformed data or permission errors are thrown, never hidden.
 */
export async function getAgency(): Promise<Agency> {
  const agencies = getStore().agencies
  if (agencies) {
    const stored = await agencies.get(AGENCY_ID)
    if (stored) return agencySchema.parse(stored)
  }
  if (storeKind() === "local") {
    const fromFile = await readAgencyFile()
    if (fromFile) return fromFile
  }
  return DEFAULT_AGENCY
}

/** The agency time zone (contract C1). */
export const getAgencyTimeZone = async (): Promise<string> =>
  (await getAgency()).timezone
