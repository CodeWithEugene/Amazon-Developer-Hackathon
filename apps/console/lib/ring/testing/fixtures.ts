import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createLocalRepository, type VisitProofRepository } from "@visitproof/db"
import type { Client } from "@visitproof/domain"
import type { TokenResponse, UserDocument } from "@visitproof/ring-partner-sdk"

import { createAesGcmCipher } from "../token-cipher"

/** Shared test fixtures for lib/ring (no network, no real credentials). */

export const TEST_CIPHER = createAesGcmCipher(Buffer.alloc(32, 7))

export const TEST_TOKENS: TokenResponse = {
  access_token: "test-access",
  refresh_token: "test-refresh",
  expires_in: 14_400,
  token_type: "Bearer",
  scope: "read",
}

export const testUser = (accountId: string, email = "family@example.com"): UserDocument => ({
  data: { id: "user-1", type: "users", attributes: { account_id: accountId, email } },
})

export const testClient = (id: string, agencyId = "a1"): Client => ({
  id,
  agencyId,
  name: "Grace Okoro",
  homeLabel: "Maple Street",
  familyContacts: [],
  ringLinkStatus: "awaiting",
  consent: {
    shareWithAgency: true,
    snapshotsEnabled: false,
    snapshotRetentionDays: 7,
    digestHour: 19,
    exceptionAlerts: true,
  },
  serviceCodes: ["T1019"],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  version: 1,
})

export const tempRepository = async (): Promise<VisitProofRepository> =>
  createLocalRepository(await mkdtemp(join(tmpdir(), "visitproof-ring-console-")))

export const tempFile = async (name: string): Promise<string> =>
  join(await mkdtemp(join(tmpdir(), "visitproof-ring-tokens-")), name)
