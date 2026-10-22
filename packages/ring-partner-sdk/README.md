# @visitproof/ring-partner-sdk

TypeScript SDK for the Ring Partner API (`https://api.amazonvision.com`), plus an offline webhook emulator. Built for VisitProof; Apache-2.0. Runtime dependency: `zod` only.

Everything below exists in `src/` and is covered by `pnpm test`. `src/endpoints.ts` says which paths were called against the live Ring Playground and which are still unverified; see [Verified Against The Ring Playground](#verified-against-the-ring-playground).

## Verified Against The Ring Playground

On 22 October 2026 (about 00:43 UTC) the SDK was run against `https://api.amazonvision.com` with a Playground token. The account has one shared device, "Playground Device" (a doorbell). The response bodies are committed in `src/fixtures/playground/`, and `manifest.json` lists each file with its request path and status code. `src/playground-fixtures.test.ts` parses every one of them.

Verified:

- `GET /v1/users/me` and `GET /v1/devices` (with and without `include=status,capabilities,configurations,location`): 200, parsed.
- `GET /v1/devices/{id}/status`, `/capabilities`, `/configurations`, `/location`: 200, parsed. The real type names are `device-status`, `device-capabilities`, `device-configurations`, and `locations`. Ring returns `null` for many fields (`state`, `audio.snooze.active`, `audio.snooze.until`, `audio.customizable_slots`, `audio.supported_actions`, `battery_status`, `flood_detection`, and the other sensor capabilities), so those are nullable while `online`, `reported_at`, `motion_detection.enabled` (`"on"` or `"off"`), motion zone vertices, and `e2e_encryption.enabled` are still validated. The sandbox doorbell reports `online: true`, motion detection on, one motion zone, end to end encryption off, audio volume 11, and location US, CA.
- `GET /v1/history/devices/{id}/events`, with and without `event_types=motion.human,ding,on_demand`: 200 with `data: []`. The SDK's earlier `/v1/devices/{id}/history/events` returned 404 and is fixed.
- `GET /v1/accounts/me/subscriptions`: 422 "Unable to process subscription request for this user" for the Playground user. `subscriptions()` throws `RingNotAvailableForAccountError`; treat it as "not available for this account".
- WHEP `POST /v1/devices/{id}/media/streaming/whep/sessions`: an SDP answer came back, ICE and DTLS reached `connected` in the embedded browser and in Google Chrome, and H264 (payload 118), RTX, and Opus were negotiated.

Not verified:

- Webhooks: the Playground cannot send them, so every delivery in this repository comes from the emulator.
- Media in live view: only about 2.4 KB arrived in 13 seconds and no `inbound-rtp` stats appeared, because the sandbox doorbell appears to send no video outside a simulated event (untested; the Playground release notes describe live view event simulation for Package, Vehicle, and Motion). `createWhepPeer` now ends such a session after 8 seconds with reason `no_video`.
- History events: the history page was empty, so the history event schema is still based on the docs, not on a real event.
- Snapshot and clip downloads and app integration writes were not called.

## Client

```ts
import { RingClient, createTokenManager, exchangeAuthorizationCode } from "@visitproof/ring-partner-sdk"

const tokens = await exchangeAuthorizationCode({ clientId, clientSecret, code, signal: AbortSignal.timeout(60_000) })
const manager = createTokenManager({ clientId, clientSecret, tokens, obtainedAt: Date.now(), store })
const ring = new RingClient({
  getAccessToken: () => manager.getAccessToken(),
  onUnauthorized: () => manager.invalidate(), // a 401 invalidates and retries once
})

await ring.me()
await ring.devices({ include: ["status", "capabilities", "configurations", "location"] })
await ring.historyEventsAll(deviceId, { eventTypes: ["ding", "motion.human"] }, 20, { sinceMs, pageDelayMs: 200 })
await ring.snapshot(deviceId, { type: "at_timestamp", timestamp: eventTs })
```

Methods: `me`, `devices`, `device`, `deviceStatus`, `deviceCapabilities`, `deviceConfigurations`, `deviceLocation`, `historyEvents`, `historyEventsAll`, `snapshot`, `clip`, `whepStart`, `whepStop`, `subscriptions`, `appIntegrationConfirm`, `appIntegrationComplete`, `appIntegrationDelete`.

Wire behavior:

- Every response is validated with Zod (`RingSchemaError` on mismatch); non-2xx maps to typed errors: `RingUnauthorizedError` (401), `RingTimeRangeNotAuthorizedError` (403), `RingNotFoundError` (404), `RingMediaNotFoundError` (416), `RingUnprocessableError` (422), `RingRecordingNotReadyError` (425), `RingRateLimitError` (429), `RingServiceUnavailableError` (503), `RingNetworkError`. `subscriptions()` raises `RingNotAvailableForAccountError` (a `RingUnprocessableError`) on 422; check it with `isNotAvailableForAccount(error)`.
- Only idempotent requests (GET, DELETE, and the snapshot and clip downloads) are retried on 429 and 503, honoring `Retry-After`. WHEP starts, app-integration writes, and token POSTs are sent once, so a rotated refresh token is never burned and no WHEP session leaks.
- Account linking: `appIntegrationConfirm` is `POST /v1/accounts/me/app-integrations { account_identifier, nonce }`; `appIntegrationComplete` is `PATCH` with `{ "status": "completed" }` (without it the integration stays Inactive); `appIntegrationDelete` is `DELETE`. Empty 204 responses resolve to `null`.
- Media: after Ring's 303 the presigned URL is fetched without the Ring bearer token. `origin`, `encrypted`, and `length` come from the 303 (`X-Media-Origin`, `X-Media-Encrypted`, `X-Media-Length`), falling back to the media response.
- History: `GET /v1/history/devices/{deviceId}/events`, with the id encoded as one path segment. Pages are newest first. `links.next` is followed as a URL or path; an opaque `meta.page_key` is sent as `page_key` on the device's history path. `event_types` is sent and also applied client-side, because another entrant reported that the server ignores it; the empty sandbox history could neither confirm nor refute that (friction log entry 3). `sinceMs` stops pagination at the consent time; `pageDelayMs` paces pages.
- WHEP: `whepStart` sends the offer as `application/sdp` and accepts `application/sdp`; the session URL comes from `Location`.

`createTokenManager` is single flight and rotation aware. Token age counts from `obtainedAt` (pass it when reloading stored tokens), and `store.set(tokens, obtainedAt)` is awaited before the new access token is handed out.

## Schemas and open enums

`src/types.ts` re-exports the schema families in `src/schemas/`: webhook envelope v1.1, JSON:API device documents, history events, users, app integrations, subscriptions, OAuth, media, and error documents. JSON:API objects are loose (unknown attributes survive).

Device sub-resources use Ring's real type names (exported as `DEVICE_RESOURCE_TYPES`) and accept `null` wherever the Playground returned it. Values Ring may extend are open enums: motion `sub_type`, history `event_type`, device `kind`, on and off toggles, `encryption_state`, app integration `status`, subscription `state`, and media origin. They accept any non-empty string and export their known values (`KNOWN_MOTION_SUB_TYPES`, `KNOWN_HISTORY_EVENT_TYPES`, ...) with `isKnownValue`. An unknown `included` resource type is kept instead of failing the devices document.

## Webhooks

```ts
const raw = new Uint8Array(await request.arrayBuffer()) // never re-serialize
if (!verifyWebhookSignature(raw, request.headers.get("x-signature"), signingKey)) return new Response(null, { status: 401 })
const parsed = parseWebhookLenient(raw)
if (!parsed.ok) return new Response(null, { status: 400 }) // not JSON, or no request/account id
if (parsed.kind === "unknown") archive(parsed.rawType, raw) // a data.type added after this build: store it, still 202
// parsed.kind === "known": parsed.envelope is the discriminated WebhookEnvelope; dedupe on dedupeKey(envelope)
```

Also: `safeParseWebhook` and `parseWebhook` (strict), `signWebhookBody`, `extractDeviceId`, `dedupeKey`, `createReplayGuard` (in-memory, for lightweight receivers and tests), `PROVENANCE_HEADER` (`x-visitproof-provenance`, honored by VisitProof's receiver only in demo mode).

## Account linking helpers

`computeAccountLinkNonce(key, timeMs, accountId)` (`base64url_nopad(HMAC_SHA256(key, "{time}:{account_id}"))`), `matchNonce` (constant time), `isFresh` (600 s window, not in the future), `findMatchingAccount` (compares every candidate, no early exit), `unclaimedBucketId(accountId)` for events that arrive while an account is still UNCLAIMED, and the constants `ACCOUNT_LINK_MAX_AGE_MS`, `AUTH_CODE_EXCHANGE_BUDGET_MS`, `UNCLAIMED_TOKEN_TTL_MS`.

## WHEP live view (browser)

Import from the browser-safe subpath, which has no Node imports:

```ts
import { createWhepPeer } from "@visitproof/ring-partner-sdk/whep"

const peer = createWhepPeer({
  videoEl,
  batteryPowered: true, // 30 s cap; false gives 60 s; or pass maxDurationMs
  signaling: (sdpOffer) => postToYourServer(sdpOffer), // returns { sdpAnswer, sessionUrl }
  teardown: (sessionUrl) => fetch(sessionUrl, { method: "DELETE" }).then(() => undefined),
  onCountdown: ({ remainingMs, totalMs }) => render(remainingMs, totalMs),
  onEnded: (reason) => show(reason), // "cap" | "stopped" | "unload" | "no_video"
})
await peer.start()
```

Track handlers are attached before `createOffer`, both transceivers are recvonly, the offer is sent after ICE gathering, and `getStats` detects stalls. Once the connection is `connected`, a session that decodes no frame within 8 seconds (`noVideoMs`) is DELETEd and ends with reason `no_video` after `onNoVideo(sample)`; this is what the Playground doorbell did when no simulated event was running. `readInboundMedia` and `classifyVideoProgress` are the pure pieces. The cap is enforced with a countdown and a DELETE; a `pagehide` listener sends a keepalive DELETE; a session created while `stop()` raced signaling is DELETEd immediately. Browsers cannot call Ring directly (CORS), so `signaling` and `teardown` go through your server.

## Media helpers

`snapshotRequestSchema`, `snapshotRequestAfterEvent` (both snapshot strategies anchored on an event), `cropWatermarkBand` (inference copy only; display frames keep the watermark), `whepCapFor`, `WHEP_BATTERY_CAP_MS`, `WHEP_WIRED_CAP_MS`, `CLIP_MAX_DURATION_MS`, and a generated placeholder JPEG (`SNAPSHOT_PLACEHOLDER_*`, provenance: placeholder).

## Emulator

The Ring Playground cannot drive webhooks (`docs/friction-log.md` entry 1), so `RingEmulator` produces HMAC-signed v1.1 deliveries locally. It is a payload generator, not an HTTP server. Every delivery has a unique `request_id`, a strictly increasing timestamp, Ring's `data.id` shape (`<device>_motion_<timestamp>`), a `timestamp_readable` of `YYYY-MM-DD HH:mm:ss` in device local time, and the header `x-visitproof-provenance: emulated`.

```ts
const emu = new RingEmulator({ signingKey })
emu.ding({ deviceId, accountId })
emu.scenario("late_arrival", { deviceId, accountId, visitStartAt })
// on_time, late_arrival, no_show, early_departure, double_visitor,
// device_offline_mid_visit, encrypted_device, integration_removed, ding,
// motion, arrival, departure; aliases missed, no_show_day,
// multiple_caregivers, unobservable

const replay = emu.twoWeeks({ startAt: Date.UTC(2026, 8, 14) }) // 00:00 UTC of day 0's date
replay.visits      // ground truth per visit (below)
replay.deliveries  // signed, oldest first, ready to POST
withRedeliveries(replay.deliveries, { rate: 0.03 }) // optional: a few identical resends and neighbor swaps
```

The two-week dataset has three clients (Okoro, Nakamura, Alvarez) and 84 visits: 62 on time, 9 late, 4 no-shows, 5 early departures, 3 unobservable, 1 double visitor. Visits start at New York local times (8:00 AM and 4:00 PM, 12:00 PM and 6:00 PM, 9:30 AM and 2:00 PM, daylight saving aware). Arrivals and departures carry deterministic seeded jitter inside the tolerances, and about one visit in four has mid-visit animal or other motion, which is not an arrival signal, so every planned outcome is unchanged. The unobservable visit's `device_offline` is exactly 30 minutes after the scheduled start.

Each `replay.visits` entry (`TwoWeeksVisitPlan`) carries the schedule (`scheduledStartAt`, `scheduledEndAt`, `localDate`, `timeZone`, `caregiver`), the intended outcome (`kind`, `expected`), the true `arrivalAt` and `departureAt`, every emitted door event (`events`), and the intended EVV behavior (`evv`: `normal` with independent jitter, `contradicted` with a clock-in 38 to 50 minutes before the door saw anyone, `missing`, or `none` for a no-show; 6 contradicted and 8 missing in total) so the demo can generate EVV data independently of the door record. `planTwoWeeks(options)` returns the same plan without signing anything.

Scenario data is exported as `SCENARIOS`, `SCENARIO_ALIASES`, `TWO_WEEKS_CLIENTS`, and `TWO_WEEKS_EVV_EXCEPTIONS`. Every delivery round-trips through `verifyWebhookSignature` and `parseWebhook` in `src/emulator/emulator.test.ts`.

## Playground smoke test and fixtures

`scripts/ring-smoke.ts` (repo root) calls the live API with a Playground token: `me`, `devices` with all includes, then `status`, `capabilities`, `configurations`, `location`, and one history page for the first shared device, and `subscriptions`. It prints PASS, INFO, or FAIL per call with provenance "Ring Playground sandbox device", then the Device Check summary (which checks pass). An empty history page is a PASS ("0 events"), and the subscriptions 422 is INFO. It writes redacted responses to `src/fixtures/playground/` and merges `manifest.json` (files, request paths, status codes); when no call succeeds, it writes nothing. The token is read from the environment only and never printed.

```sh
export RING_PLAYGROUND_ACCESS_TOKEN=...   # 30 minute token from the Ring Developer Playground
pnpm --filter @visitproof/ring-partner-sdk ring:smoke            # writes fixtures
pnpm --filter @visitproof/ring-partner-sdk ring:smoke -- --no-write
```

The repository root has the same command as `pnpm ring:smoke`, and `pnpm ring:token` (macOS) saves a token from the clipboard into `.env` without printing it. `redactFixture` (exported) strips `first_name`, `last_name`, `email`, `phone_number`, every token or secret key, bearer strings, and presigned URL signatures, without mutating its input.

## Mock Ring Playground

`src/testing/mock-playground.ts` is a local stand in for the Ring Partner API that serves the captured Playground responses: `users/me`, `devices` (with or without `include`), one device, the four device sub-resources, history (an empty page), subscriptions (422), and WHEP (POST returns an SDP answer and a session `Location`; DELETE ends it). It accepts any non-empty bearer token and never calls Ring.

```sh
pnpm --filter @visitproof/ring-partner-sdk mock:playground        # http://127.0.0.1:3271 (add -- --port=3275 to change)
RING_API_BASE=http://127.0.0.1:3271 RING_PLAYGROUND_ACCESS_TOKEN=mock-playground \
  RING_OAUTH_TOKEN_URL=http://127.0.0.1:3271/oauth/token pnpm --filter @visitproof/console dev
```

Use a dummy token such as `mock-playground`, never a real one. `RING_OAUTH_TOKEN_URL` points at the mock so no token request can reach Ring; the mock has no OAuth route and answers one with an error. Values exported in the shell win over `.env`, so the console then runs in live mode against the mock: Device Check reads 4 of 4 required checks passing plus the informational Human Detection item, Sync Ring History reports that Ring returned no events, and Live View completes signaling and stops with a DELETE. The mock's SDP answer has no ICE candidates, so the browser never connects and no video plays. In tests, `createMockPlaygroundHandler()` is a fetch style handler you can pass straight to `RingClient` as `fetch`, with no port at all. Import it and the fixtures from `@visitproof/ring-partner-sdk/testing`.

## Layout

```
src/
  index.ts          public entry (whep.ts is also published as ./whep)
  types.ts          re-exports src/schemas/* (the shared wire contract)
  schemas/          webhook, devices, history, account, media, error-document, open-enum
  client.ts         RingClient; client-support.ts holds its pure helpers
  http.ts           retrying fetch wrapper (429 and 503, Retry-After)
  oauth.ts          code exchange, refresh, single-flight token manager
  webhook.ts        signature verification, strict and lenient parsing
  nonce.ts          account link nonce, unclaimed bucket id
  media.ts          snapshot bodies, watermark crop
  whep.ts           browser WHEP live view helper
  whep-video.ts     no video detection helpers used by whep.ts
  emulator/         RingEmulator, scenarios, two-week planner, jitter, time zone, redelivery
  fixtures/         placeholder snapshot, redaction, playground/ (real Playground responses and manifest)
  testing/          mock Ring Playground server and SDP answer (exported as ./testing, not published)
```

## Scripts

`pnpm build` (tsup to `dist/`, entries `index` and `whep`), `pnpm test` (Vitest: 128 tests in 14 files, all passing on 22 October 2026), `pnpm typecheck`, `pnpm lint`, `pnpm ring:smoke`, `pnpm mock:playground`.
