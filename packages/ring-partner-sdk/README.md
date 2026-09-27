# @visitproof/ring-partner-sdk

TypeScript SDK for the Ring Partner API (`https://api.amazonvision.com`) plus an offline emulator for the webhook event path. Built for VisitProof; published under Apache-2.0. Runs fully offline in demo mode: no Ring credentials, no hardware.

## Surface

- `RingClient`: `me`, `devices`, `device`, `deviceStatus`, `deviceCapabilities`, `deviceConfigurations`, `deviceLocation`, `historyEvents` / `historyEventsAll` (client-side event type filtering, auto-pagination), `snapshot`, `clip`, `whepStart`, `whepStop`, `subscriptions`, `appIntegrationConfirm`, `appIntegrationComplete`, `appIntegrationDelete`.
- `exchangeAuthorizationCode` and `createTokenManager` (single-flight, rotation-aware refresh; call `invalidate()` after a 401).
- `verifyWebhookSignature(rawBody, header, key)` (constant time, `sha256=` hex) and `safeParseWebhook` / `parseWebhook` (v1.1 envelope, discriminated on `data.type`).
- `computeAccountLinkNonce(key, timeMs, accountId)`, `matchNonce`, `isFresh`, `findMatchingAccount`.
- `createWhepPeer(...)` browser live-view helper (handlers before `createOffer`, recvonly, ICE gathering complete, `getStats` stall detection) and `cropWatermarkBand(...)`.
- `RingEmulator`: signed v1.1 webhook payloads, scenario scripts, and the scripted two-week replay dataset.
- Zod schemas for webhook v1.1, JSON:API device documents, history events, and error documents (`src/types.ts`, the shared contract).

## Client usage

```ts
import { RingClient, createTokenManager } from "@visitproof/ring-partner-sdk"

const tokens = await exchangeAuthorizationCode({ clientId, clientSecret, code }) // within 60 s of issue
const manager = createTokenManager({ clientId, clientSecret, tokens })
const ring = new RingClient({ getAccessToken: () => manager.getAccessToken() })

const me = await ring.me()
const devices = await ring.devices({ include: ["status", "capabilities"] })
const events = await ring.historyEventsAll(deviceId, { eventTypes: ["ding", "motion.human"] })
const frame = await ring.snapshot(deviceId, { type: "at_timestamp", timestamp: eventTs })
```

Errors are typed: `RingUnauthorizedError`, `RingMediaNotFoundError` (416), `RingRecordingNotReadyError` (425), `RingTimeRangeNotAuthorizedError` (403), `RingRateLimitError` (429, after honoring `Retry-After` and retrying), `RingServiceUnavailableError`, `RingNetworkError`, `RingSchemaError`.

## Webhook receiver

```ts
const raw = new Uint8Array(await request.arrayBuffer()) // never re-serialize
if (!verifyWebhookSignature(raw, request.headers.get("x-signature"), process.env.RING_HMAC_SIGNING_KEY!)) {
  return new Response("invalid signature", { status: 401 })
}
const envelope = parseWebhook(raw) // throws WebhookParseError on a bad schema
// dedupe on envelope.meta.request_id
```

## Emulator

The Ring Playground cannot drive webhooks (see `docs/friction-log.md` entry 1), so `RingEmulator` generates HMAC-signed v1.1 payloads locally. Every delivery has a unique `request_id` and a strictly increasing timestamp (replay-safe), and the exact bytes that were signed are provided so receivers verify them the way Ring would.

```ts
import { RingEmulator } from "@visitproof/ring-partner-sdk"

const emu = new RingEmulator({ signingKey: process.env.RING_HMAC_SIGNING_KEY! })

// Primitives
const ding = emu.ding({ deviceId: "emu_dev_okoro_front_door", accountId: "ava1.ring.account.okoro" })

// Named scenarios (anchored on a visit start): on_time, late_arrival, no_show,
// early_departure, double_visitor, device_offline_mid_visit, encrypted_device,
// integration_removed, plus aliases missed, no_show_day, multiple_caregivers,
// unobservable.
const deliveries = emu.scenario("late_arrival", { deviceId, accountId, visitStartAt })

for (const d of deliveries) {
  await fetch(webhookUrl, { method: "POST", headers: d.headers, body: d.rawBody })
}

// Scripted two-week demo dataset: three clients (Okoro, Nakamura, Alvarez),
// 84 visits (62 on time, 9 late, 4 no-show, 5 early, 3 unobservable, 1 double).
const replay = emu.twoWeeks({ startAt: Date.UTC(2026, 8, 14) })
replay.visits // per-visit plan: scheduled start/end, caregiver, expected status
replay.deliveries // ordered, signed, ready to POST in sequence
```

Scenario fixtures are exported as data (`SCENARIOS`, `TWO_WEEKS_CLIENTS` from the package root) so the demo app can render the scenario list without instantiating the emulator. Every delivery round-trips through `verifyWebhookSignature` and `parseWebhook` (asserted in `src/emulator/emulator.test.ts`).

## Layout

```
src/
  index.ts        public entry
  types.ts        wire types and Zod schemas (shared contract)
  client.ts       typed RingClient (fetch-based, rate-limit aware)
  oauth.ts        code exchange + single-flight rotation-aware refresh
  whep.ts         browser WHEP live view helper
  webhook.ts      signature verification and envelope parsing
  nonce.ts        account link nonce
  media.ts        snapshot request bodies + watermark crop
  emulator/       RingEmulator + scenario fixtures (scenarios.ts)
  fixtures/       placeholder snapshot frame (provenance metadata included)
```

## Scripts

`pnpm build` (tsup to `dist/`), `pnpm test` (Vitest), `pnpm typecheck`, `pnpm lint`.
