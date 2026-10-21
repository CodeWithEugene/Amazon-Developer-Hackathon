import "server-only"

import {
  createDynamoRepository,
  createLocalRepository,
  type VisitProofRepository,
} from "@visitproof/db"

import { storeDir } from "./paths"

export const AGENCY_ID = "a1"

/** `VISITPROOF_STORE=dynamo` opts into DynamoDB; anything else is local. */
export const storeKind = (): "local" | "dynamo" =>
  process.env.VISITPROOF_STORE === "dynamo" ? "dynamo" : "local"

/**
 * A fresh repository per call so requests never see a stale table cache.
 * The local JSON store backs the offline demo; DynamoDB is used only when
 * explicitly selected, so a stray DYNAMODB_TABLE never reaches AWS.
 */
export function getStore(): VisitProofRepository {
  if (storeKind() === "dynamo") {
    return createDynamoRepository({
      config: {
        tableName: process.env.DYNAMODB_TABLE ?? "visitproof",
        region: process.env.AWS_REGION ?? "us-east-1",
      },
    })
  }
  return createLocalRepository(storeDir())
}
