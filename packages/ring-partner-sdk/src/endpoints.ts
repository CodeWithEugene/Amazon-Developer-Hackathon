/**
 * Ring Partner API paths, shared by the client and the emulator so the two
 * cannot drift. Paths follow docs/research.md Section 2; where the public docs
 * leave a path implicit it is marked "assumed" and should be confirmed against
 * the Playground explorer before certification.
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
  historyEvents: (id: string) => `${ENDPOINTS.device(id)}/history/events`,
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
