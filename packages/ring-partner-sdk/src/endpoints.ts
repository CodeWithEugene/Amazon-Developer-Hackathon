/**
 * Ring Partner API paths, shared by the client and the mocks so the two
 * cannot drift. Paths follow docs/research.md Section 2. `me`, `devices`, the
 * four device sub-resources, `historyEvents`, `whepSessions`, and
 * `subscriptions` were called against the live Ring Playground on
 * 22 October 2026 (see src/fixtures/playground/manifest.json); the media
 * download and app integration paths are still unverified.
 */

export const DEFAULT_RING_API_BASE = "https://api.amazonvision.com"
export const DEFAULT_RING_OAUTH_TOKEN_URL = "https://oauth.ring.com/oauth/token"

export const ENDPOINTS = {
  me: "/v1/users/me",
  devices: "/v1/devices",
  device: (id: string) => `/v1/devices/${encodeURIComponent(id)}`,
  deviceStatus: (id: string) => `${ENDPOINTS.device(id)}/status`,
  deviceCapabilities: (id: string) => `${ENDPOINTS.device(id)}/capabilities`,
  deviceConfigurations: (id: string) => `${ENDPOINTS.device(id)}/configurations`,
  deviceLocation: (id: string) => `${ENDPOINTS.device(id)}/location`,
  /**
   * Device history. Verified against the Ring Playground on 22 October 2026:
   * `/v1/history/devices/{id}/events` returns 200 while the earlier
   * `/v1/devices/{id}/history/events` guess returned 404.
   */
  historyEvents: (id: string) => `/v1/history/devices/${encodeURIComponent(id)}/events`,
  imageDownload: (id: string) => `${ENDPOINTS.device(id)}/media/image/download`,
  videoDownload: (id: string) => `${ENDPOINTS.device(id)}/media/video/download`,
  whepSessions: (id: string) => `${ENDPOINTS.device(id)}/media/streaming/whep/sessions`,
  /** Chime audio playback (write capability, unused by VisitProof v1). */
  audioPlayback: (id: string) => `${ENDPOINTS.device(id)}/media/audio/playback`,
  subscriptions: "/v1/accounts/me/subscriptions",
  appIntegrations: "/v1/accounts/me/app-integrations",
} as const

export const HEADERS = {
  signature: "x-signature",
  mediaOrigin: "x-media-origin",
  mediaLength: "x-media-length",
  mediaEncrypted: "x-media-encrypted",
  retryAfter: "retry-after",
  location: "location",
} as const

export const CONTENT_TYPES = {
  jsonApi: "application/vnd.api+json",
  json: "application/json",
  sdp: "application/sdp",
  form: "application/x-www-form-urlencoded",
} as const
