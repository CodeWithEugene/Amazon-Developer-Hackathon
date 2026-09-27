import { z } from "zod"

/**
 * Shared entity contract for VisitProof (docs/build.md Section 4).
 * Every entity carries `createdAt`, `updatedAt`, and `version`. Timestamps are
 * ISO 8601 strings in UTC unless the field name ends in `Ms`.
 */

const isoDateTime = z.iso.datetime({ offset: true })
const isoDate = z.iso.date()

export const idSchema = z.string().min(1)
export type Id = z.infer<typeof idSchema>

export const auditFieldsSchema = z.object({
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  version: z.number().int().nonnegative(),
})
export type AuditFields = z.infer<typeof auditFieldsSchema>

// ---------------------------------------------------------------------------
// Agency
// ---------------------------------------------------------------------------

export const tolerancesSchema = z.object({
  graceMin: z.number().int().nonnegative().default(15),
  escalationMin: z.number().int().nonnegative().default(45),
  earlyDepartureMin: z.number().int().nonnegative().default(10),
  departureQuietMin: z.number().int().nonnegative().default(10),
})
export type Tolerances = z.infer<typeof tolerancesSchema>

export const DEFAULT_TOLERANCES: Tolerances = Object.freeze(
  tolerancesSchema.parse({})
)

export const notificationDefaultsSchema = z.object({
  digestHour: z.number().int().min(0).max(23).default(19),
  exceptionAlerts: z.boolean().default(true),
})
export type NotificationDefaults = z.infer<typeof notificationDefaultsSchema>

export const agencySchema = auditFieldsSchema.extend({
  id: idSchema,
  name: z.string().min(1),
  state: z.string().length(2),
  timezone: z.string().min(1),
  tolerances: tolerancesSchema,
  retentionDays: z.number().int().positive().default(365),
  evvVendor: z.string().optional(),
  notificationDefaults: notificationDefaultsSchema,
})
export type Agency = z.infer<typeof agencySchema>

// ---------------------------------------------------------------------------
// Client (care recipient household)
// ---------------------------------------------------------------------------

export const ringLinkStatusSchema = z.enum([
  "unlinked",
  "awaiting",
  "linked",
  "paused",
  "removed",
])
export type RingLinkStatus = z.infer<typeof ringLinkStatusSchema>

export const familyContactSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  relationship: z.string().optional(),
  cognitoSub: z.string().optional(),
})
export type FamilyContact = z.infer<typeof familyContactSchema>

export const consentSchema = z.object({
  shareWithAgency: z.boolean().default(true),
  snapshotsEnabled: z.boolean().default(false),
  snapshotRetentionDays: z.number().int().positive().default(7),
  digestHour: z.number().int().min(0).max(23).default(19),
  exceptionAlerts: z.boolean().default(true),
  consentedAt: isoDateTime.optional(),
})
export type Consent = z.infer<typeof consentSchema>

export const clientSchema = auditFieldsSchema.extend({
  id: idSchema,
  agencyId: idSchema,
  name: z.string().min(1),
  homeLabel: z.string().min(1),
  familyContacts: z.array(familyContactSchema),
  ringLinkStatus: ringLinkStatusSchema,
  consent: consentSchema,
  serviceCodes: z.array(z.string().min(1)),
})
export type Client = z.infer<typeof clientSchema>

// ---------------------------------------------------------------------------
// Ring integration and devices
// ---------------------------------------------------------------------------

export const encryptionStateSchema = z.enum([
  "clear",
  "take",
  "e2ee",
  "unknown",
])
export type EncryptionState = z.infer<typeof encryptionStateSchema>

export const integrationStatusSchema = z.enum([
  "pending",
  "awaiting",
  "completed",
  "removed",
])
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>

export const ringIntegrationSchema = auditFieldsSchema.extend({
  clientId: idSchema,
  accountId: z.string().min(1),
  encryptedTokens: z.string().min(1),
  tokenExpiresAt: isoDateTime,
  refreshTokenIssuedAt: isoDateTime,
  integrationStatus: integrationStatusSchema,
  consentedAt: isoDateTime,
  encryptionState: encryptionStateSchema,
})
export type RingIntegration = z.infer<typeof ringIntegrationSchema>

export const deviceRoleSchema = z.enum(["front_door", "other"])
export type DeviceRole = z.infer<typeof deviceRoleSchema>

export const deviceLocationSchema = z.object({
  country: z.string().length(2),
  state: z.string().optional(),
})

export const deviceCapabilitiesSummarySchema = z.object({
  motionDetection: z.boolean(),
  humanDetection: z.boolean(),
  liveView: z.boolean(),
  snapshots: z.boolean(),
  battery: z.boolean(),
})
export type DeviceCapabilitiesSummary = z.infer<
  typeof deviceCapabilitiesSummarySchema
>

export const deviceSchema = auditFieldsSchema.extend({
  clientId: idSchema,
  ringDeviceId: z.string().min(1),
  name: z.string().min(1),
  online: z.boolean(),
  capabilities: deviceCapabilitiesSummarySchema,
  motionRecordingEnabled: z.boolean(),
  hasMotionZone: z.boolean(),
  location: deviceLocationSchema.optional(),
  lastEventAt: isoDateTime.optional(),
  role: deviceRoleSchema,
})
export type Device = z.infer<typeof deviceSchema>

// ---------------------------------------------------------------------------
// Caregiver
// ---------------------------------------------------------------------------

export const caregiverSchema = auditFieldsSchema.extend({
  id: idSchema,
  agencyId: idSchema,
  name: z.string().min(1),
  mobile: z.string().optional(),
  email: z.email().optional(),
  evvEmployeeId: z.string().optional(),
  magicLinkTokenHash: z.string().optional(),
})
export type Caregiver = z.infer<typeof caregiverSchema>

// ---------------------------------------------------------------------------
// Door events
// ---------------------------------------------------------------------------

export const eventProvenanceSchema = z.enum([
  "ring_webhook",
  "ring_history",
  "playground",
  "emulated",
])
export type EventProvenance = z.infer<typeof eventProvenanceSchema>

export const doorEventTypeSchema = z.enum([
  "motion",
  "ding",
  "on_demand",
  "device_online",
  "device_offline",
  "device_added",
  "device_removed",
  "integration_added",
  "integration_removed",
  "sensor",
])
export type DoorEventType = z.infer<typeof doorEventTypeSchema>

export const motionSubTypeSchema = z.enum([
  "human",
  "vehicle",
  "animal",
  "other_motion",
])
export type MotionSubType = z.infer<typeof motionSubTypeSchema>

export const doorEventSchema = auditFieldsSchema.extend({
  clientId: idSchema,
  requestId: z.string().min(1),
  timestampMs: z.number().int().nonnegative(),
  at: isoDateTime,
  type: doorEventTypeSchema,
  subType: z.string().optional(),
  deviceId: z.string().optional(),
  provenance: eventProvenanceSchema,
  rawPayloadHash: z.string().min(1),
  componentIds: z.array(z.string()).default([]),
})
export type DoorEvent = z.infer<typeof doorEventSchema>

// ---------------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------------

export const visitStatusSchema = z.enum([
  "scheduled",
  "awaiting_arrival",
  "arrived_on_time",
  "arrived_late",
  "no_show",
  "in_progress",
  "completed",
  "early_departure",
  "departure_not_observed",
  "unobservable",
  "ambiguous",
])
export type VisitStatus = z.infer<typeof visitStatusSchema>

export const observabilityStateSchema = z.enum([
  "observable",
  "degraded",
  "unobservable",
])
export type ObservabilityState = z.infer<typeof observabilityStateSchema>

export const observabilityReasonSchema = z.enum([
  "device_offline",
  "no_front_door_device",
  "motion_recording_off",
  "no_motion_zone",
  "encrypted_device",
  "integration_removed",
  "integration_paused",
  "consent_withdrawn",
])
export type ObservabilityReason = z.infer<typeof observabilityReasonSchema>

export const observabilitySchema = z.object({
  state: observabilityStateSchema,
  reasons: z.array(observabilityReasonSchema),
})
export type Observability = z.infer<typeof observabilitySchema>

export const boundarySourceSchema = z.enum(["rule", "jev", "manual"])
export type BoundarySource = z.infer<typeof boundarySourceSchema>

export const visitBoundarySchema = z.object({
  at: isoDateTime,
  eventId: z.string().optional(),
  source: boundarySourceSchema,
  confidence: z.number().min(0).max(1).optional(),
})
export type VisitBoundary = z.infer<typeof visitBoundarySchema>

export const reconciliationOutcomeSchema = z.enum([
  "corroborated",
  /**
   * Both sides present, but a delta sits in the 10 to 30 minute band
   * (docs/solution.md Section 6.2 rule 5): not a clean corroboration, not
   * a hard contradiction. The deltas on the record carry the detail.
   */
  "corroborated_with_variance",
  "contradicted",
  "missing_clock_in",
  "missing_door",
  "missing_both",
  "unobservable",
  "pending",
])
export type ReconciliationOutcome = z.infer<typeof reconciliationOutcomeSchema>

export const reconciliationSchema = z.object({
  outcome: reconciliationOutcomeSchema,
  evvRecordId: z.string().optional(),
  clockIn: isoDateTime.optional(),
  clockOut: isoDateTime.optional(),
  deltaArrivalMin: z.number().optional(),
  deltaDepartureMin: z.number().optional(),
  gpsDistanceM: z.number().nonnegative().optional(),
})
export type Reconciliation = z.infer<typeof reconciliationSchema>

export const narrativeProvenanceSchema = z.enum(["template", "bedrock"])
export type NarrativeProvenance = z.infer<typeof narrativeProvenanceSchema>

export const narrativeSchema = z.object({
  text: z.string().min(1),
  provenance: narrativeProvenanceSchema,
  generatedAt: isoDateTime,
})
export type Narrative = z.infer<typeof narrativeSchema>

export const visitSchema = auditFieldsSchema.extend({
  id: idSchema,
  clientId: idSchema,
  agencyId: idSchema,
  caregiverId: idSchema,
  serviceCode: z.string().min(1),
  date: isoDate,
  scheduledStart: isoDateTime,
  scheduledEnd: isoDateTime,
  authorizedUnits: z.number().nonnegative().optional(),
  status: visitStatusSchema,
  arrival: visitBoundarySchema.optional(),
  departure: visitBoundarySchema.optional(),
  observability: observabilitySchema,
  reconciliation: reconciliationSchema.optional(),
  narrative: narrativeSchema.optional(),
})
export type Visit = z.infer<typeof visitSchema>

// ---------------------------------------------------------------------------
// EVV records
// ---------------------------------------------------------------------------

export const evvSourceSchema = z.enum(["csv", "manual", "caregiver_link"])
export type EvvSource = z.infer<typeof evvSourceSchema>

export const evvRecordSchema = auditFieldsSchema.extend({
  id: idSchema,
  clientId: idSchema,
  agencyId: idSchema,
  caregiverEvvId: z.string().min(1),
  serviceCode: z.string().min(1),
  clockIn: isoDateTime,
  clockOut: isoDateTime.optional(),
  verificationMethod: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  source: evvSourceSchema,
  visitId: idSchema.optional(),
})
export type EVVRecord = z.infer<typeof evvRecordSchema>

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

export const exceptionKindSchema = z.enum([
  "late_no_arrival",
  "late_arrival",
  "no_show",
  "early_departure",
  "unobservable",
  "contradicted",
  "missing_clock_in",
  "ambiguous",
])
export type ExceptionKind = z.infer<typeof exceptionKindSchema>

export const exceptionStateSchema = z.enum(["open", "snoozed", "resolved"])
export type ExceptionState = z.infer<typeof exceptionStateSchema>

export const exceptionResolutionSchema = z.object({
  by: z.string().min(1),
  at: isoDateTime,
  reason: z.string().min(1),
  note: z.string().optional(),
})
export type ExceptionResolution = z.infer<typeof exceptionResolutionSchema>

export const exceptionSchema = auditFieldsSchema.extend({
  id: idSchema,
  agencyId: idSchema,
  visitId: idSchema,
  clientId: idSchema,
  kind: exceptionKindSchema,
  state: exceptionStateSchema,
  openedAt: isoDateTime,
  snoozeUntil: isoDateTime.optional(),
  resolution: exceptionResolutionSchema.optional(),
})
export type Exception = z.infer<typeof exceptionSchema>

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export const ledgerColumnSchema = z.enum(["observed", "reported", "resolved"])
export type LedgerColumn = z.infer<typeof ledgerColumnSchema>

export const ledgerRecordSchema = z.object({
  clientId: idSchema,
  seq: z.number().int().nonnegative(),
  column: ledgerColumnSchema,
  subject: idSchema,
  payloadHash: z.string().min(1),
  prevHash: z.string().min(1),
  signature: z.string().min(1),
  signerKeyId: z.string().min(1),
  at: isoDateTime,
})
export type LedgerRecord = z.infer<typeof ledgerRecordSchema>

// ---------------------------------------------------------------------------
// Notes and snapshots
// ---------------------------------------------------------------------------

export const authorRoleSchema = z.enum([
  "agency_admin",
  "agency_staff",
  "family",
  "caregiver",
  "system",
])
export type AuthorRole = z.infer<typeof authorRoleSchema>

export const noteClassificationSchema = z.enum([
  "dispute",
  "explanation",
  "fyi",
])
export type NoteClassification = z.infer<typeof noteClassificationSchema>

export const noteSchema = auditFieldsSchema.extend({
  id: idSchema,
  visitId: idSchema,
  authorRole: authorRoleSchema,
  authorId: z.string().min(1),
  at: isoDateTime,
  text: z.string().min(1).max(2000),
  classification: noteClassificationSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
})
export type Note = z.infer<typeof noteSchema>

export const mediaOriginSchema = z.enum(["recording", "snapshot"])
export type MediaOrigin = z.infer<typeof mediaOriginSchema>

export const snapshotSchema = auditFieldsSchema.extend({
  visitId: idSchema,
  at: isoDateTime,
  s3Key: z.string().min(1),
  mediaOrigin: mediaOriginSchema,
  labels: z.array(z.string()),
  watermarkBandPx: z.number().int().nonnegative(),
  requestedAt: isoDateTime,
  provenance: eventProvenanceSchema,
  expiresAt: z.number().int().nonnegative().optional(),
})
export type Snapshot = z.infer<typeof snapshotSchema>
