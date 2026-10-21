/**
 * Seeds the fresh store: the agency (repository record plus the legacy
 * agency.json the MCP server reads), clients with consent, caregivers,
 * Ring account links, and the 84 scheduled visits from the emulator plan.
 * Visit dates are agency-local calendar dates (contract C1).
 */
import { writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { VisitProofRepository } from "@visitproof/db"
import {
  localDateKey,
  type Caregiver,
  type Client,
  type Visit,
} from "@visitproof/domain"
import type {
  TwoWeeksReplay,
  TwoWeeksVisitPlan,
} from "@visitproof/ring-partner-sdk"

import { AGENCY_ID, TIME_ZONE } from "./config"
import { audit, CAREGIVERS, CLIENTS, demoAgency, infoFor } from "./fixtures"

const iso = (epochMs: number): string => new Date(epochMs).toISOString()

/** Stable visit id per plan: v_<client>_<nn> in schedule order. */
export function visitIds(plans: readonly TwoWeeksVisitPlan[]): string[] {
  const perClient = new Map<string, number>()
  return plans.map((plan) => {
    const index = perClient.get(plan.clientId) ?? 0
    perClient.set(plan.clientId, index + 1)
    return `v_${plan.clientId.replace("cli_", "")}_${String(index).padStart(2, "0")}`
  })
}

const clientEntity = (clientId: string, at: string): Client => {
  const info = infoFor(CLIENTS, clientId, "client")
  return {
    ...audit(at),
    id: clientId,
    agencyId: AGENCY_ID,
    name: info.name,
    homeLabel: info.homeLabel,
    familyContacts: [
      {
        name: info.familyName,
        email: info.familyEmail,
        relationship: info.relationship,
      },
    ],
    ringLinkStatus: "linked",
    consent: {
      shareWithAgency: true,
      snapshotsEnabled: info.snapshotsEnabled,
      snapshotRetentionDays: 7,
      digestHour: 19,
      exceptionAlerts: true,
      consentedAt: at,
    },
    serviceCodes: [info.serviceCode],
  }
}

const caregiverEntity = (id: string, at: string): Caregiver => {
  const info = infoFor(CAREGIVERS, id, "caregiver")
  return {
    ...audit(at),
    id,
    agencyId: AGENCY_ID,
    name: info.name,
    mobile: info.mobile,
    email: `${id.replace("cg_", "")}@example.com`,
    evvEmployeeId: info.evvEmployeeId,
  }
}

const visitEntity = (plan: TwoWeeksVisitPlan, id: string): Visit => ({
  ...audit(iso(plan.scheduledStartAt - 7 * 24 * 60 * 60 * 1000)),
  id,
  clientId: plan.clientId,
  agencyId: AGENCY_ID,
  caregiverId: plan.caregiver,
  serviceCode: infoFor(CLIENTS, plan.clientId, "client").serviceCode,
  date: localDateKey(iso(plan.scheduledStartAt), TIME_ZONE),
  scheduledStart: iso(plan.scheduledStartAt),
  scheduledEnd: iso(plan.scheduledEndAt),
  authorizedUnits: 8,
  status: "scheduled",
  observability: { state: "observable", reasons: [] },
})

export interface SeedSummary {
  readonly caregivers: number
  readonly visitIds: readonly string[]
}

export async function seedStore(
  repo: VisitProofRepository,
  storeDir: string,
  replay: TwoWeeksReplay
): Promise<SeedSummary> {
  const at = iso(replay.startAt)
  const agency = demoAgency(at)
  await repo.agencies?.put(agency)
  await writeFile(
    join(storeDir, "agency.json"),
    `${JSON.stringify(agency, null, 2)}\n`
  )
  for (const client of replay.clients) {
    await repo.clients.put(clientEntity(client.clientId, at))
    await repo.ringLinks.link(client.clientId, client.accountId, new Date(at))
  }
  const caregiverIds = [...new Set(replay.visits.map((plan) => plan.caregiver))]
  for (const id of caregiverIds)
    await repo.caregivers.put(caregiverEntity(id, at))
  const ids = visitIds(replay.visits)
  for (const [index, plan] of replay.visits.entries()) {
    await repo.visits.put(visitEntity(plan, ids[index]!))
  }
  return { caregivers: caregiverIds.length, visitIds: ids }
}
