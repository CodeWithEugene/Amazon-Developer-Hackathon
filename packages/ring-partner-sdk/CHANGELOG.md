# Changelog

## Unreleased

- Verified against the live Ring Playground on 22 October 2026. Device sub-resource schemas now use Ring's real type names (`device-status`, `device-capabilities`, `device-configurations`, `locations`), accept `null` wherever Ring returns it, and validate `online`, `reported_at`, `motion_detection.enabled`, motion zone geometry, and `e2e_encryption.enabled`. The guessed fields (`human_detection`, `live_view`, `motion_recording_enabled`) are gone. Real responses are committed under `src/fixtures/playground/` with a manifest of request paths and status codes.
- Fixed the history URL: `/v1/history/devices/{deviceId}/events` (the earlier `/v1/devices/{id}/history/events` returned 404).
- `subscriptions()` turns a 422 into `RingNotAvailableForAccountError` (a `RingUnprocessableError`); `isNotAvailableForAccount` helper.
- `createWhepPeer` ends a session that reaches `connected` but decodes no frame within 8 s (`onNoVideo`, end reason `no_video`), DELETEing it so it does not hold Ring's session cap. Pure helpers `readInboundMedia` and `classifyVideoProgress`.
- `@visitproof/ring-partner-sdk/testing` (source only, not published): the Playground fixtures and a mock Ring Playground server (`pnpm mock:playground`).
- `appIntegrationComplete` sends `PATCH { status: "completed" }`; `appIntegrationDelete` sends `DELETE`; empty 204 responses resolve to `null`.
- Presigned media is fetched without the Ring bearer token; media headers are read from the 303 first.
- Open enums for motion sub types, history event types, device kinds, encryption states, integration and subscription states; unknown `included` resources are kept. `parseWebhookLenient` returns unknown `data.type` deliveries with their raw type instead of failing.
- History pagination treats `meta.page_key` as an opaque cursor (`page_key` query parameter) and follows `links.next` as a URL; `sinceMs` and `pageDelayMs` options.
- Only idempotent requests are retried; token, WHEP, and app-integration POSTs are sent once. `onUnauthorized` retries once after a 401. Token age counts from `obtainedAt`, and rotated tokens are persisted before use.
- `createWhepPeer` enforces the 30 s and 60 s caps with a countdown, DELETEs on stop, cap, and `pagehide` (keepalive), and cleans up a session created during a racing stop. Published as the browser-safe `./whep` subpath.
- Emulator: New York local schedule with seeded jitter and mid-visit non-arrival motion (outcome counts unchanged), `x-visitproof-provenance: emulated` header, Ring-style `data.id` and `timestamp_readable`, ground-truth plan with intended EVV behavior, `withRedeliveries`.
- `redactFixture` and the Playground smoke test (`ring:smoke`). Removed the unused `hono` dependencies.
- Package skeleton with the Ring wire types (webhook envelope v1.1, JSON:API device documents, history events, token response, error document).
