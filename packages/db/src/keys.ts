import { utcDateOf } from "./time"

/**
 * Single-table key builders (docs/build.md Section 4). Every entity maps to
 * `pk` / `sk`; time-ordered queries use `gsi1`, external-id lookups use `gsi2`.
 */

export type Key = { readonly pk: string; readonly sk: string }
export type GsiKey = { readonly gsi1pk: string; readonly gsi1sk: string }

// -- Visits ------------------------------------------------------------------

export const visitKeys = (visit: {
  clientId: string
  id: string
  scheduledStart: string
}): Key => ({
  pk: `CLIENT#${visit.clientId}`,
  sk: `VISIT#${visit.scheduledStart}#${visit.id}`,
})

export const visitGsi1 = (visit: {
  agencyId: string
  scheduledStart: string
}): GsiKey => ({
  gsi1pk: `AGENCY#${visit.agencyId}`,
  gsi1sk: `DATE#${utcDateOf(visit.scheduledStart)}#${visit.scheduledStart}`,
})

// -- Door events -------------------------------------------------------------

export const eventKeys = (event: {
  clientId: string
  timestampMs: number
  requestId: string
}): Key => ({
  pk: `CLIENT#${event.clientId}`,
  sk: `EVENT#${event.timestampMs}#${event.requestId}`,
})

// -- EVV records -------------------------------------------------------------

export const evvKeys = (record: {
  clientId: string
  clockIn: string
  id: string
}): Key => ({
  pk: `CLIENT#${record.clientId}`,
  sk: `EVV#${record.clockIn}#${record.id}`,
})

// -- Exceptions --------------------------------------------------------------

export const exceptionKeys = (exception: {
  agencyId: string
  openedAt: string
  id: string
}): Key => ({
  pk: `AGENCY#${exception.agencyId}`,
  sk: `EXC#${exception.openedAt}#${exception.id}`,
})

export const exceptionGsi1 = (exception: {
  agencyId: string
  state: string
  openedAt: string
}): GsiKey => ({
  gsi1pk: `AGENCY#${exception.agencyId}`,
  gsi1sk: `STATUS#${exception.state}#${exception.openedAt}`,
})

// -- People ------------------------------------------------------------------

export const caregiverKeys = (caregiver: {
  agencyId: string
  id: string
}): Key => ({
  pk: `AGENCY#${caregiver.agencyId}`,
  sk: `CAREGIVER#${caregiver.id}`,
})

export const clientKeys = (client: {
  agencyId: string
  id: string
}): Key => ({
  pk: `AGENCY#${client.agencyId}`,
  sk: `CLIENT#${client.id}`,
})

// -- Evidence ----------------------------------------------------------------

export const noteKeys = (note: { visitId: string; at: string; id: string }): Key => ({
  pk: `VISIT#${note.visitId}`,
  sk: `NOTE#${note.at}#${note.id}`,
})

export const snapshotKeys = (snapshot: { visitId: string; at: string }): Key => ({
  pk: `VISIT#${snapshot.visitId}`,
  sk: `SNAP#${snapshot.at}`,
})

const LEDGER_SEQ_WIDTH = 12

export const ledgerKeys = (record: {
  clientId: string
  seq: number
}): Key => ({
  pk: `CLIENT#${record.clientId}`,
  sk: `LEDGER#${String(record.seq).padStart(LEDGER_SEQ_WIDTH, "0")}`,
})

// -- Webhook receipts (idempotency) ------------------------------------------

export const webhookReceiptKeys = (requestId: string): Key => ({
  pk: `WEBHOOK#${requestId}`,
  sk: "META",
})

// -- Ring account links (external-id lookup via gsi2) -------------------------

export const ringAccountKeys = (accountId: string): Key => ({
  pk: `RINGACCT#${accountId}`,
  sk: "META",
})
