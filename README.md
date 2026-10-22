# VisitProof

**Proof of presence for home care, from the doorbell already at the door.**

VisitProof is a Ring Appstore app and web console for home-care agencies and the families who employ them. It turns the events a Ring doorbell already produces into an independent, timestamped, tamper-evident record of when a caregiver arrived at and left a client's home, matched against the agency's schedule and the caregiver's own Electronic Visit Verification (EVV) clock-in.

Built for the **Build, Ship, Shape: Amazon Developer Hackathon 2026**. Primary track: Ring. Mini challenges: AWS Builder and Open Source. Secondary: Alexa+ (an MCP server over the same data).

## Why

- Every Medicaid-funded home-care visit must be electronically verified, and in 2026 states moved to hard edits: claims without a verified visit are denied automatically.
- GPS clock-ins from a caregiver's phone are unreliable, can be spoofed, and fail when the phone dies.
- Families cannot tell whether the caregiver came, when, or for how long. No-shows are the top family complaint.
- A Ring doorbell is already at the door, owned by the family, and produces server-signed, timestamped events.

## What It Does

| For | What VisitProof shows |
| --- | --- |
| Agency scheduler | A Today board with each visit's status from the door and exception cards (late, no-show, early departure, unobservable). Backfill Times records an agency correction without ever overwriting what the door observed. |
| Compliance and billing | Reconciliation of every EVV clock-in against the door record (corroborated, with variance, contradicted, missing, unobservable), a signed hash-chained evidence ledger, a PDF evidence pack per client, and an Open EVV Style JSON export. |
| Family | One daily view of the day's visits, consent controls (share with the agency, snapshots, digest hour), Export My Data, and Delete Everything. |
| Caregiver | Their own visit record, with notes kept in their own Reported column. |
| Alexa+ and agents | An MCP server (Streamable HTTP) with voice-first tools such as `get_visit_status`, and the Ask VisitProof page in the console. |

Principles: corroboration, not surveillance; events first, pixels optional; three columns never merged (Observed, Reported, Resolved); deterministic decisions, narrated in plain language; honest boundaries.

## What Runs Where

| Capability | Live against the Ring Partner API with a Playground token | Emulated in the demo | On AWS (us-east-1) |
| --- | --- | --- | --- |
| Ring webhooks (motion, doorbell press, device and integration lifecycle) | No: the Playground cannot send webhooks (friction log entry 1) | Yes: 181 HMAC-signed v1.1 deliveries from the SDK emulator, posted over HTTP to the real receiver | Deployed: API Gateway plus Lambda receiver, verified on 22 October 2026 with a signed synthetic webhook (202 signed, 401 unsigned or tampered) |
| Account (`users/me`, subscriptions) | Yes: `users/me` returned 200 on 22 October 2026. Subscriptions returned 422 for the Playground user, which the SDK reports as "not available for this account" | No | |
| Device check (devices, status, capabilities, configurations, location) | Yes: `/family/devices`. All five calls returned 200 on 22 October 2026 (one shared "Playground Device" doorbell). The schemas were then corrected against the captured responses, on which Device Check reads 4 of 4 required checks passing plus 1 informational item | No | |
| Event history sync | Yes: Sync Ring History on `/family/devices` (stored with provenance `ring_history`). On 22 October 2026 history returned 200 with zero events, and the console shows "No Ring Events Since Consent" | No | |
| Live view (WHEP) | Live video: on 22 October 2026 at about 08:35 EAT, after a Motion "Simulate live view event" was started in the Ring Developer Playground, `/family/live` decoded real video over WHEP from the sandbox doorbell (250 frames at 1280x720). Earlier sessions without a simulation connected but got no media. `/family/live` ends a session that decodes no frame within 8 seconds and says so, with Ring's session cap countdown | No | |
| Account linking (Account Link URL, Token Exchange URL, App Homepage URL) | Routes exist: `/link`, `/api/ring/token-exchange`, `/ring`; a real link needs a Ring app registration and Ring's Appstore flow | No | |
| Presence Engine (arrival, departure, late, no-show, early departure, unobservable) | | Yes: the real engine handlers replayed in simulated time | Deployed: DynamoDB Streams event processor and an EventBridge visit sweeper every minute, both verified |
| EVV reconciliation | | Yes: an independent vendor CSV generated from the emulator's ground truth, imported through the domain parser | |
| Signed evidence ledger | | Yes: local HMAC stand-in for the KMS signer | Deployed: KMS ECDSA P-256 signer, which signed a ledger record in the end to end check |
| Narratives | | Yes: deterministic template, agency time zone | Deployed with a template fallback; Bedrock Nova 2 Lite calls are throttled until the account's Nova quotas (0 today) are raised |
| Snapshots | | No | Code ready: Ring snapshot to S3 with retention tags (the bucket is deployed; snapshots stay off until a token store exists) |
| Ask VisitProof | | Yes: offline fixture brain calling the local MCP server | Code ready: Strands Agents on Bedrock (`MODEL_PROVIDER=bedrock`), not deployed |
| Email digests and alerts | | Logged only | Code ready: SES, not configured (no sender identity) |

Four CDK stacks (Data, Observability, Webhook, Engine) are deployed in `us-east-1`; the console, the MCP server, and Ask VisitProof still run locally. The arrival Judge runs the deterministic rule judge; a TypeSafe Jev judge behind the same port is planned, not built.

## Judge Quick Start

**Live demo:** https://visitproof.codewitheugene.top. Sign in with one click as any role; no install needed. It runs the console on the sample data `pnpm demo` produces (one recorded run, moved onto the current week with times kept in Eastern Time, and the demo ledger re-signed). Changes you make there (resolving a card, a backfill, consent) last only while that server instance stays warm. Two things need a local run: Ask VisitProof (the hosted site does not run the MCP server, so `/ask` explains that) and live Ring mode (it needs a Ring Developer Playground token, so the hosted Ring screens show "Live Mode Is Off").

To run everything locally:

Requirements: Node 22 or newer and pnpm 10 or newer. No AWS account or Ring credentials are needed.

```bash
pnpm install
pnpm demo
```

When the terminal prints "VisitProof demo is ready", open http://localhost:3000 and sign in with one click as the **Scheduler**, the **Compliance Lead**, a **Family Member**, or a **Caregiver**. Ctrl+C stops every service the demo started.

| Service | Default | Override |
| --- | --- | --- |
| Console | http://localhost:3000 | `PORT` |
| Webhook receiver | http://localhost:3101/health | `WEBHOOK_PORT` |
| MCP server | http://localhost:8000/mcp | `MCP_PORT` |
| Local store | `.demo-data/` (git-ignored) | `VISITPROOF_DEMO_STORE_PATH` |

The demo checks every port before it touches anything and exits with the name of the process holding a taken port. It resets only a directory it created (marked with `.visitproof-demo-store`), inside the repository or the temp directory, and holds a lock so a second demo cannot reset a store in use. To run a second copy beside the first:

```bash
PORT=3200 WEBHOOK_PORT=3201 MCP_PORT=3202 VISITPROOF_DEMO_STORE_PATH=/tmp/vp-demo pnpm demo
```

What `pnpm demo` does (`scripts/demo/`):

1. Seeds one agency (America/New_York), three clients (Okoro, Nakamura, Alvarez), six caregivers, three Ring account links, and 84 visits over the last 14 days at realistic local times. The last day is today.
2. Starts the webhook receiver (`apps/webhooks`) with `VISITPROOF_ENGINE_INLINE=false` and posts 181 signed emulator deliveries (10 of them twice, as Ring's at-least-once delivery does). Every delivery is verified, deduplicated, persisted, and acknowledged with 202.
3. Replays the real engine handlers (`apps/engine`: event processor and visit sweeper) over the persisted events in simulated time, in 5 minute ticks. The engine appends signed ledger records as it observes door events, visit changes, raised cards, and system resolutions.
4. Writes independent EVV clock records to `.demo-data/evv-import.csv` from the emulator's ground truth (normal clock-ins with small jitter and a GPS fix near the home, 6 contradicted clock-ins 38 to 50 minutes early from about 2 to 3 km away, 8 missing), imports them through `parseEvvCsv`, reconciles every visit, then writes narratives in the agency time zone.
5. Prints a summary and checks it against the dataset: 84 visits, all signed deliveries accepted, 9 late arrivals, 4 no-shows, 5 early departures, 3 unobservable (device offline, encrypted device, integration removed), 6 contradicted and 8 missing clock-ins.
6. Starts the MCP server and the console over the same store.

By default the replay runs until every visit has settled, so when you run it during the day, today's later visits show their planned outcome ahead of the clock (the demo says so). `VISITPROOF_DEMO_UNTIL=now` stops the replay at the current time instead.

Things to try: resolve or snooze an exception card and use Backfill Times on the Today board; download the evidence pack PDF and the Open EVV Style export on the Compliance page; read the family view and change consent; ask "Did the caregiver come to Mom's today?" on `/ask`.

## Live Ring Mode

1. Mint a token in the Ring Developer Playground and copy it (it lasts about 30 minutes and cannot be refreshed).
2. Run `pnpm ring:token` (macOS). It reads the token from the clipboard, writes it to `.env` at the repository root as `RING_PLAYGROUND_ACCESS_TOKEN`, never prints it, and clears the clipboard. On other systems, add that line to `.env` yourself.
3. Run `pnpm ring:smoke`. It calls `users/me`, `devices`, the first device's status, capabilities, configurations, and location, one history page, and subscriptions. It prints PASS, INFO, or FAIL per call and the Device Check summary for each shared device, and writes redacted responses to `packages/ring-partner-sdk/src/fixtures/playground/` (add `-- --no-write` to skip that; nothing is written when no call succeeds).
4. Run `pnpm demo`. From `.env` the demo passes only `RING_PLAYGROUND_ACCESS_TOKEN`, `RING_API_BASE`, and `VISITPROOF_TOKEN_KEY` to the console, which then runs `/family/devices` and `/family/live` against the real API with the provenance label "Ring Playground sandbox device". Everything else in the demo stays emulated.

What we verified against the live Playground on 22 October 2026 (about 00:43 UTC, `https://api.amazonvision.com`):

- `GET /v1/users/me` and `GET /v1/devices`: 200. One shared device, "Playground Device", a doorbell.
- `GET /v1/devices/{id}/status`, `/capabilities`, `/configurations`, and `/location`: 200. The sandbox doorbell reports online, motion detection on with one motion zone, end to end encryption off, and location US, CA. Our first schemas rejected all four (real type names such as `device-status`, and many `null` fields); they are fixed and tested against the captured bodies (friction log entry 16).
- `GET /v1/history/devices/{id}/events`, with and without `event_types`: 200 with zero events. The sandbox doorbell has no history, so `event_types` filtering could not be checked.
- `GET /v1/accounts/me/subscriptions`: 422 for the Playground user, reported as INFO.
- WHEP live view, first run: the session was created and ICE and DTLS connected in the embedded browser and in Google Chrome, but only about 2.4 KB arrived in 13 seconds and no video frame was decoded, because no simulated event was running.

A second live run on 22 October 2026 at about 08:35 EAT, checked by our demo recorder:

- Device Check against the live Ring Partner API read 4 of 4 required checks passing.
- Sync Ring History succeeded live ("Ring History Synced"). History returned real events (`on_demand` sessions with epoch millisecond times, which the console now converts to ISO).
- Live view: after a Motion "Simulate live view event" was started in the Ring Developer Playground, VisitProof's own `/family/live` decoded real video over WHEP from the sandbox doorbell, 250 frames at 1280x720. The sandbox streams only during a simulated event; this is now confirmed (friction log entry 18). To see video, start a Motion, Package, or Vehicle simulation for the Playground Device first, then select Start Live View. The sample stream is "Birds on Feeders" by Michael Black, CC BY 4.0.
- Not verified live: webhooks (the Playground cannot send them), snapshot and clip downloads, and app integration writes.

On those responses (served by the mock Ring Playground below) `pnpm ring:smoke` prints PASS for me, devices, status, capabilities, configurations, location, and history ("0 events"), INFO for subscriptions, and a Device Check summary of "4 of 4 required checks passing"; Human Detection is a fifth, informational item that does not count.

Without a token, the mock Ring Playground serves the same captured responses on 127.0.0.1, so the smoke run and the console's live mode work offline. See "Mock Ring Playground" in [packages/ring-partner-sdk/README.md](packages/ring-partner-sdk/README.md); use a dummy token such as `mock-playground`, never a real one.

## How VisitProof Uses The Ring Partner API

| Ring capability | Where |
| --- | --- |
| Typed client for `/v1/users/me`, devices, status, capabilities, configurations, location, history (both pagination styles), snapshots, clips, WHEP start and stop, subscriptions, and app integrations | `packages/ring-partner-sdk/src/client.ts`, `packages/ring-partner-sdk/src/endpoints.ts` |
| Webhook HMAC-SHA256 verification over the raw bytes, v1.1 schemas, lenient parsing of unknown event types | `packages/ring-partner-sdk/src/webhook.ts`, `packages/ring-partner-sdk/src/schemas/` |
| OAuth token exchange and single-flight refresh | `packages/ring-partner-sdk/src/oauth.ts`, `apps/console/app/api/ring/token-exchange/`, `apps/console/lib/ring/token-exchange.ts` |
| Account Link URL and App Homepage URL | `apps/console/app/link/`, `apps/console/app/ring/` |
| Webhook URL receiver: verify, dedupe on request id, route the Ring account, persist, 202 before any engine work | `apps/webhooks/src/receive.ts`, `apps/webhooks/src/index.ts` |
| Device check and history sync | `apps/console/lib/ring/device-check.ts`, `apps/console/lib/ring/history-sync.ts`, `apps/console/app/family/devices/` |
| Live view over WHEP (browser-safe helper, session caps, ends a session that decodes no video within 8 seconds) | `packages/ring-partner-sdk/src/whep.ts`, `packages/ring-partner-sdk/src/whep-video.ts`, `apps/console/app/api/ring/stream/`, `apps/console/app/family/live/` |
| Captured Playground responses and a mock Ring Playground that serves them | `packages/ring-partner-sdk/src/fixtures/playground/`, `packages/ring-partner-sdk/src/testing/mock-playground.ts` |
| Snapshot download to S3 (deployable, not used in the demo) | `apps/engine/src/adapters/ring-snapshot-service.ts` |
| Emulator: signed v1.1 deliveries, scenarios, and the two-week ground-truth plan | `packages/ring-partner-sdk/src/emulator/` |

Every door event carries its provenance (`ring_webhook`, `ring_history`, `playground`, or `emulated`) and the UI shows it next to the event.

## AWS Integrations

VisitProof's backend is a CDK v2 app in `infra/` with four stacks, and they are live in `us-east-1` (env `dev`): Data (DynamoDB single table with streams and PITR, an S3 media bucket, KMS token and ECDSA P-256 ledger signing keys), Observability (SNS alerts topic and a 100 USD budget), Webhook (API Gateway HTTP API `POST /ring/webhook` to the receiver Lambda) and Engine (stream event processor, visit sweeper every minute, daily digest). On 22 October 2026 we checked the whole event path with a synthetic signed Ring webhook. The signed request returned 202, while unsigned, wrong-key and tampered requests returned 401, and a duplicate returned 202 duplicate. The door event landed in DynamoDB, the stream ran the Presence Engine, and the engine wrote a ledger record signed by KMS. Not live yet: Bedrock narratives (the account's Nova 2 Lite quotas are 0, so the engine falls back to the deterministic template), SES mail, alert email subscriptions, the Ring webhook registration, and the Auth, MCP on AgentCore and Hosting stacks. The console still runs locally. Status, evidence, cost (about 3 to 5 USD a month) and teardown steps are in [docs/aws-integrations.md](docs/aws-integrations.md). Every adapter is also tested with `aws-sdk-client-mock`.

## MCP And Ask VisitProof

- `apps/mcp` is an MCP server over Streamable HTTP on `MCP_PORT` (default 8000). Tools: `get_visit_status`, `list_visits`, `list_exceptions`, `explain_visit`, `get_client_summary`, `acknowledge_exception`, and `add_visit_note` (the two writes ask for confirmation and append to the signed ledger). Resources: `visitproof://schedule/{clientId}/{date}` and `visitproof://feed/{clientId}/today`. Prompt: `morning_briefing`. A bearer token is required; demo tokens work only in demo mode. Agency answers hide households that stopped sharing with the agency.
- `/ask` in the console is an Alexa+ style simulator: the copilot (`apps/copilot`) picks tools and calls the MCP server at `MCP_URL`. The default brain is an offline fixture; `MODEL_PROVIDER=bedrock` uses a Strands agent on Bedrock. The page shows tools by readable titles ("Visit Status"), opens on the Visual tab, and keeps the raw MCP request and result (code-form tool names, UTC timestamps) in a Response Detail tab labeled as protocol data.
- Checks: `pnpm mcp:conformance` and the golden utterances in `pnpm --filter @visitproof/copilot test`.

## Development

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm typecheck:scripts && pnpm test:scripts   # the demo scripts
pnpm --filter @visitproof/console build
pnpm --filter infra exec cdk synth --no-lookups
```

Last verified run (22 October 2026): `pnpm -r test` passes 655 of 655 tests in 77 files, and `pnpm test:scripts` passes 16 of 16 in 3 files, so 671 tests pass in all.

| Package | Tests | Files |
| --- | --- | --- |
| `packages/config` | 5 | 1 |
| `packages/ring-partner-sdk` | 128 | 14 |
| `packages/domain` | 140 | 12 |
| `packages/db` | 36 | 5 |
| `apps/mcp` | 61 | 5 |
| `infra` | 17 | 1 |
| `apps/engine` | 53 | 9 |
| `apps/copilot` | 43 | 4 |
| `apps/webhooks` | 22 | 3 |
| `apps/console` | 150 | 23 |
| `scripts` (`pnpm test:scripts`) | 16 | 3 |

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/build.md](docs/build.md). Friction we hit with the platforms is in [docs/friction-log.md](docs/friction-log.md).

## Boundaries

VisitProof is not an EVV system of record, not identity verification, not resident monitoring, and not a medical device. It shows that a person arrived at the door; it never identifies who. It uses no facial recognition, never correlates across Ring accounts, and works fully without video access.

## License

Apache License 2.0. See [LICENSE.md](LICENSE.md).
