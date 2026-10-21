/**
 * Fictional demo people and places (docs/build.md Section 15: never real
 * people or real addresses). Home coordinates are made up points in central
 * Ohio, used only to give the EVV fixture realistic GPS readings.
 */
import type { Agency } from "@visitproof/domain"
import { DEFAULT_TOLERANCES } from "@visitproof/domain"

import { AGENCY_ID, TIME_ZONE } from "./config"

export interface CaregiverInfo {
  readonly name: string
  readonly evvEmployeeId: string
  readonly mobile: string
}

export const CAREGIVERS: Readonly<Record<string, CaregiverInfo>> = {
  cg_amara: {
    name: "Amara Okafor",
    evvEmployeeId: "EVV-1001",
    mobile: "+15550000001",
  },
  cg_daniel: {
    name: "Daniel Reyes",
    evvEmployeeId: "EVV-1002",
    mobile: "+15550000002",
  },
  cg_yuki: {
    name: "Yuki Tanaka",
    evvEmployeeId: "EVV-1003",
    mobile: "+15550000003",
  },
  cg_priya: {
    name: "Priya Sharma",
    evvEmployeeId: "EVV-1004",
    mobile: "+15550000004",
  },
  cg_marisol: {
    name: "Marisol Vega",
    evvEmployeeId: "EVV-1005",
    mobile: "+15550000005",
  },
  cg_ana: {
    name: "Ana Ruiz",
    evvEmployeeId: "EVV-1006",
    mobile: "+15550000006",
  },
}

export interface ClientInfo {
  readonly name: string
  readonly homeLabel: string
  readonly familyName: string
  readonly familyEmail: string
  readonly relationship: string
  readonly serviceCode: string
  readonly snapshotsEnabled: boolean
  readonly home: { readonly lat: number; readonly lng: number }
}

export const CLIENTS: Readonly<Record<string, ClientInfo>> = {
  cli_okoro: {
    name: "Grace Okoro",
    homeLabel: "Maple Street",
    familyName: "Priya Okoro",
    familyEmail: "priya@example.com",
    relationship: "Daughter",
    serviceCode: "T1019",
    snapshotsEnabled: true,
    home: { lat: 39.9612, lng: -82.9988 },
  },
  cli_nakamura: {
    name: "Ken Nakamura",
    homeLabel: "Elm Court",
    familyName: "Mika Nakamura",
    familyEmail: "mika@example.com",
    relationship: "Son",
    serviceCode: "T1019",
    snapshotsEnabled: false,
    home: { lat: 40.0582, lng: -83.0206 },
  },
  cli_alvarez: {
    name: "Rosa Alvarez",
    homeLabel: "Cedar Avenue",
    familyName: "Luis Alvarez",
    familyEmail: "luis@example.com",
    relationship: "Son",
    serviceCode: "G0299",
    snapshotsEnabled: false,
    home: { lat: 39.9101, lng: -82.9143 },
  },
}

export const infoFor = <T>(
  table: Readonly<Record<string, T>>,
  id: string,
  what: string
): T => {
  const info = table[id]
  if (info === undefined) throw new Error(`no demo ${what} fixture for ${id}`)
  return info
}

export const audit = (at: string) => ({
  createdAt: at,
  updatedAt: at,
  version: 1,
})

export const demoAgency = (at: string): Agency => ({
  id: AGENCY_ID,
  name: "Caring Hands Home Care",
  state: "OH",
  timezone: TIME_ZONE,
  tolerances: DEFAULT_TOLERANCES,
  retentionDays: 365,
  evvVendor: "State EVV Portal",
  notificationDefaults: { digestHour: 19, exceptionAlerts: true },
  ...audit(at),
})
