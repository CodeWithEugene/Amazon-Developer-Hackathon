# Devpost Submission Draft

> Paste-ready text for every field of the Build, Ship, Shape submission form. Items marked **TO FILL** depend on the video upload. The AWS stacks were deployed and verified on 22 October 2026. The live Ring Playground run happened on 22 October 2026 and its results are filled in below. Everything else matches the code on `main`. Copy rule for all fields: Title Case headings and button names, no em or en dashes.

---

## Project Name

VisitProof

## Elevator Pitch (Tagline)

Proof of presence for home care, from the Ring doorbell already at the door: real-time no-show alerts, EVV reconciliation, and one calm message a day for families.

## Tracks And Challenges To Select

- Primary track: **Ring**
- Also judged in: **Alexa+** (self-hosted MCP server, spec 2025-11-25, Streamable HTTP, plus a simulated Alexa+ experience at `/ask`)
- Mini challenges: **AWS Builder**, **Open Source**

## Video Link

**TO FILL:** public YouTube or Vimeo URL (under 3 minutes).

Thumbnail image: `docs/assets/thumbnail.png` (a JPEG copy is at `docs/assets/thumbnail.jpg`).

## Try It Out Links

- Live demo: https://visitproof.codewitheugene.top (sample data from the `pnpm demo` pipeline, moved onto the current week; sign in with one click as any role)
- Source code: https://github.com/CodeWithEugene/Amazon-Developer-Hackathon (Apache-2.0)

The live demo runs the console only, on demo data. Ask VisitProof needs the MCP server, so on the hosted site `/ask` says so and points to `pnpm demo`. Live Ring mode is off there (no token is configured); live Ring needs a Ring Developer Playground token on a local run.

---

## About The Project

### Inspiration

Every Medicaid-funded home-care visit in the United States must be electronically verified, with six data elements: service, recipient, caregiver, date, location, and start and end time. In 2026 states switched from soft edits to hard edits, so a claim without a matching verified visit is now denied automatically (Missouri from April 2026, with Minnesota, Ohio, Indiana, Pennsylvania, and Massachusetts following). Most agencies verify visits with a GPS clock-in from the caregiver's phone, which drifts, can be spoofed, and fails when the phone dies in a basement apartment.

At 6:10 AM a scheduler does not know whether the 6:00 AM caregiver is late, standing at the door with no signal, or not coming. Two weeks later the same visit comes back as a denied claim. Meanwhile the client's daughter texts the agency for the third time this month: "Did anyone actually come today?"

All three share one blind spot: nobody has an independent, timestamped record of when a person arrived at and left the client's door. Millions of those doors already have a Ring doorbell, owned by the family, producing signed events. VisitProof turns it into that record.

### What It Does

VisitProof is a Ring Appstore style app and web console with four roles over one store:

- **Scheduler (Today board).** Live visit status from the door. Exception cards for late arrival, no-show, early departure, and unobservable visits, grouped into Today, Earlier This Week, and Older, with Call Caregiver, Snooze, Resolve, and Backfill Times. A correction never overwrites what the door observed.
- **Compliance lead.** Reconciles every EVV clock-in against the door record over Today, This Week, or Two Weeks: corroborated, contradicted, missing clock-in with door presence, missing both, or unobservable. Every observation, report, and resolution is appended to a hash-chained, signed ledger. One click exports a paginated PDF evidence pack with the chain and pack hash, and an Open EVV style JSON export for visit maintenance.
- **Family.** One calm card a day ("The caregiver came for both visits"), at most one alert for today, earlier days collapsed. Granular consent (share with the agency, arrival snapshots with expiry, alerts), Export My Data, and Delete Everything, all enforced in code. Device Check and Live View read the family's Ring doorbell through the Ring Partner API.
- **Caregiver.** Their own two weeks of visits with the door times next to their clock-in, so a caregiver whose phone died still has proof they were there, plus notes and disputes in their own signed column.
- **Ask VisitProof (Alexa+).** "Did the caregiver come to Mom's today?" answered by an MCP server over Streamable HTTP, shown in an Echo Show style simulator. Each answer names the tool it called by a readable title, and the raw MCP request and result sit in a Response Detail tab labeled as protocol data.

Principles we held to: corroboration, not surveillance (it says a person arrived at the door, never who); events first, pixels optional (everything works with zero video, so Ring's TAKE encryption does not break it); three columns never merged (Observed, Reported, Resolved); unobservable windows are recorded as unobservable, never as absence.

### How We Built It

**Ring Partner API at runtime**

| Ring capability | Where in the code |
|---|---|
| Typed client: users/me, devices with include, status, capabilities, configurations, location, event history, snapshots (303 flow), clips, WHEP sessions, subscriptions, app integrations (POST nonce confirm, PATCH completed) | `packages/ring-partner-sdk/src/client.ts` |
| Webhook verification: HMAC-SHA256 over the raw body bytes, constant time, v1.1 schemas, dedupe on `meta.request_id`, 202 before any engine work | `packages/ring-partner-sdk/src/webhook.ts`, `apps/webhooks/src/receive.ts` |
| One-way account linking: Token Exchange URL (60 second exchange), Account Link URL (nonce freshness and constant-time match), App Homepage URL | `apps/console/app/api/ring/token-exchange/`, `apps/console/app/link/`, `apps/console/app/ring/` |
| Device Check and Ring history sync (provenance `ring_history`) | `apps/console/lib/ring/device-check.ts`, `apps/console/lib/ring/history-sync.ts` |
| Live view over WHEP with Ring's 30 and 60 second session caps, ending a connected session that decodes no video within 8 seconds | `packages/ring-partner-sdk/src/whep.ts`, `packages/ring-partner-sdk/src/whep-video.ts`, `apps/console/app/family/live/` |
| Captured Playground responses as fixtures, and a mock Ring Playground that serves them for offline tests | `packages/ring-partner-sdk/src/fixtures/playground/`, `packages/ring-partner-sdk/src/testing/mock-playground.ts` |
| Emulator: HMAC-signed v1.1 deliveries and a two-week ground-truth plan, because the Playground cannot send webhooks | `packages/ring-partner-sdk/src/emulator/` |

**Live Playground run (22 October 2026).** Against the Playground sandbox doorbell, `users/me`, `devices`, status, capabilities, configurations, location, and history all returned 200 (history with zero events, so no event types were seen), subscriptions returned 422 for the Playground user, and a WHEP session negotiated H264 and Opus with ICE and DTLS connected but no media from the sandbox, because no simulation was running. Our first schemas rejected all four device sub-resources (real type names and many `null` fields), and our history path was wrong; both are fixed and tested against the captured responses, on which Device Check reads 4 of 4 required checks passing.

**Second live run (22 October 2026, about 08:35 EAT, checked by our demo recorder).** Device Check against the live Ring Partner API read 4 of 4 required checks passing. Sync Ring History succeeded live ("Ring History Synced") and returned real `on_demand` events with epoch millisecond times, which we now convert to ISO. After we started a Motion "Simulate live view event" in the Ring Developer Playground, VisitProof's own `/family/live` decoded real video over WHEP from the sandbox doorbell: 250 frames at 1280x720 (sample stream "Birds on Feeders" by Michael Black, CC BY 4.0). This confirms that the sandbox streams only during a simulated event.

**Presence Engine.** A pure, clock-injected TypeScript engine (`packages/domain`) implements twelve EARS requirements: observable windows, arrival clustering, a judge for ambiguous double arrivals, departure revised as events arrive, late, no-show and early-departure cards, an unobservable overlay from device lifecycle events, nearest-visit assignment for overlapping windows, and reconciliation bands at 10 and 30 minutes. Domain coverage is about 99 percent of statements.

**Demo pipeline.** `pnpm demo` seeds one New York agency, three clients, six caregivers, and 84 visits over two weeks, posts 181 signed webhooks (10 duplicated, as Ring's at-least-once delivery does) to the real receiver, replays the real engine handlers in simulated time, imports independent EVV clock-ins from a vendor-style CSV, and checks the outcome against the plan: 9 late, 4 no-shows, 5 early departures, 3 unobservable, 6 contradicted, 8 missing clock-ins.

**AWS.** See the AWS Builder section below.

**MCP and Alexa+.** `apps/mcp` uses the official TypeScript SDK 1.x: tools `get_visit_status`, `list_visits`, `list_exceptions`, `explain_visit`, `get_client_summary`, `acknowledge_exception`, `add_visit_note` (writes confirm through elicitation or a `confirmed` argument, because the documented Alexa+ client does not advertise elicitation), a schedule resource, a `morning_briefing` prompt, version negotiation for 2025-11-25 and 2025-03-26, Origin and Host validation, scoped bearer tokens, and protected-resource metadata. A conformance suite exercises it over real HTTP.

**UI.** Next.js 16 App Router, React 19, Tailwind CSS v4, and strictly shadcn/ui on Base UI primitives, with agency-local times everywhere and WCAG 2.2 AA as the bar.

**Quality.** 671 automated tests (Vitest), all passing on 22 October 2026: 655 across the ten workspace packages and 16 for the demo scripts. GitHub Actions CI, TypeScript strict, Zod at every boundary.

### Challenges We Ran Into

- The Ring Playground gives a live sandbox doorbell but no motion or doorbell events (history came back empty) and no webhook delivery, so we built a signed-webhook emulator and kept Playground calls for devices, history, and live view, with provenance labels on every event.
- Our first live run failed on real data: every device sub-resource returned 200, but strict schemas written from the docs rejected the real type names and `null` fields, and Device Check showed 0 of 5 checks passing. We captured the responses as fixtures, corrected the schemas while still validating the fields we rely on, and built a mock Playground so the fix could be tested after the 30 minute token expired.
- Live view connected (ICE and DTLS) but the sandbox doorbell sent no video until we started a live view event simulation in the Playground; with one running we decoded 250 frames at 1280x720. A black player looks like a WebRTC bug, so Live View now ends a session with no video after 8 seconds and tells the family plainly that Ring connected but no video arrived.
- The official `ring-api-helloworld` sample checks a static bearer token instead of the `X-Signature` HMAC and uses an older payload shape, so we implemented verification from the documentation and tested it with our own vectors.
- Departure detection: the first quiet gap after arrival is not a departure. The engine revises departure as later in-window events arrive.
- Time zones: an agency in New York, a developer in Nairobi, and Ring timestamps in UTC. Every user-facing time is now rendered in the agency's zone.
- Evidence integrity: an agency correction must never overwrite the door's observation, so corrections live in their own signed column.

### Accomplishments That We're Proud Of

- A one-command demo that goes over real HTTP through the real receiver and reproduces the planned dataset exactly.
- A signed, hash-chained ledger and an evidence pack a compliance lead could hand to an auditor.
- An honest product: it says what it can prove and what it cannot, and the UI labels every emulated event.

### What We Learned

- Treat absence carefully: "we saw nothing" and "we were not watching" are different claims, and the record must keep them apart.
- Ring's read-only API is a strength for this product. VisitProof cannot control anything in the home, which makes it easier for families to say yes.
- Capture real responses on first contact. Thirty minutes of a live token, recorded into fixtures and a mock server, was worth more than days of schemas written from documentation.

### What's Next For VisitProof

Private-app pilots with home-care agencies, Ring Appstore certification (questionnaire drafted in `docs/compliance.md`), alternate-EVV vendor onboarding in Provider Choice states, Cognito sign-in, the MCP server on AgentCore Runtime, and an Echo Show family view through MCP Apps.

### Boundaries

VisitProof is not an EVV system of record, not identity verification, not resident monitoring, and not a medical device. It never uses facial recognition and never correlates across Ring accounts.

---

## Criteria Map

| Criterion | Evidence |
|---|---|
| Tech Implementation | Ring Partner API client, HMAC webhook receiver, account-linking endpoints, WHEP live view, Presence Engine with 12 EARS requirements, signed ledger, 671 passing tests, CI |
| Design | Four coherent role journeys, agency-local times, one calm daily message for families, strict shadcn/ui, designed empty, loading, and error states |
| Potential Impact | 2026 Medicaid EVV hard edits, unreliable GPS clock-ins, family transparency; distribution through the Ring Appstore elder-care category and agency sales |
| Quality Of The Idea | The doorbell already at the door as an independent proof-of-presence signal; agency-first and EVV-aware, where existing Ring apps watch the resident |

---

## Built With

TypeScript, Next.js, React, Tailwind CSS, shadcn/ui, Base UI, Ring Partner API, Model Context Protocol, Node.js, Hono, Express, Zod, Vitest, Playwright, AWS CDK, AWS Lambda, Amazon API Gateway, Amazon DynamoDB, Amazon EventBridge, Amazon S3, AWS KMS, Amazon SES, Amazon Bedrock, Amazon Nova, Strands Agents, pnpm, Turborepo

---

## Testing Instructions

Requirements: Node 22 or newer and pnpm 10 or newer. No AWS account or Ring credentials are needed.

```bash
git clone https://github.com/CodeWithEugene/Amazon-Developer-Hackathon.git
cd Amazon-Developer-Hackathon
pnpm install
pnpm demo
```

When the terminal prints "VisitProof demo is ready", open http://localhost:3000 and use the one-click Demo Sign In for the Scheduler, Compliance Lead, Family Member, or Caregiver. Things to try:

1. Scheduler: open an exception card, View Visit (Observed, Reported, Resolved), Backfill Times, Resolve.
2. Compliance Lead: choose Two Weeks, filter Contradicted, download the PDF evidence pack and the Open EVV style JSON.
3. Family Member: the daily card, consent controls, and `/ask` ("Did the caregiver come today?").
4. Caregiver: a visit with a missing clock-in and door presence; add a note.

If ports 3000, 3101, or 8000 are taken, the demo names the process and stops. Use `PORT`, `WEBHOOK_PORT`, and `MCP_PORT` to change them. Live Ring mode needs a 30 minute Ring Developer Playground token (README, Live Ring Mode). To see live video, first start a Motion, Package, or Vehicle "Simulate live view event" for the Playground Device in the Ring Developer Playground, then select Start Live View on `/family/live`. Without a running simulation the sandbox doorbell sends no video, and VisitProof says so after 8 seconds.

---

## Product Feedback (Required)

**Tools, APIs, and SDKs used, and for what**

- **Ring Partner API** (`api.amazonvision.com`): devices, status, capabilities, configurations, location, event history, WHEP live view, app integrations, webhook payloads v1.1.
- **Ring Developer Playground**: a 30 minute token and the shared sandbox doorbell ("Playground Device") for Device Check, history, and live view. On 22 October 2026 we called `users/me`, devices, status, capabilities, configurations, location, history, subscriptions, and a WHEP session from both our smoke script and the console, recorded every response, and finished the fixes against those recordings after the token expired.
- **Ring developer documentation and `ring-api-helloworld`**: API reference, account linking, webhook signatures, WHEP browser pattern.
- **Model Context Protocol TypeScript SDK 1.x**: the VisitProof MCP server and the client in Ask VisitProof.
- **AWS CDK, Lambda, API Gateway, DynamoDB, EventBridge, S3, KMS, SES, Bedrock (Nova 2 Lite), Strands Agents SDK**: see AWS Builder below.

**What worked well**

- The Partner API is clean JSON:API with opaque ids and consistent `data`, `relationships`, and `meta` envelopes. Every read we made on the Playground answered 200 quickly, and `devices?include=status,capabilities,configurations,location` returns everything Device Check needs in one call.
- Minting a Playground token takes seconds, and the sandbox doorbell is ready to query immediately.
- WHEP signaling worked first time: the session answered with an SDP that negotiated H264, RTX, and Opus, and ICE and DTLS connected in Google Chrome.
- The configurations resource exposes `e2e_encryption.enabled`, so end to end encryption is detectable before requesting media.
- Webhook signing over raw bytes plus a request id for dedupe is exactly what a reliable receiver needs.
- The read-only scope is a feature: families can say yes because the app cannot control anything in their home.
- The MCP TypeScript SDK made a spec-correct Streamable HTTP server straightforward, including version negotiation.

**What needs work**

- The Playground cannot deliver webhooks or produce motion and doorbell events: the sandbox history is empty, so neither the event path nor `event_types` filtering can be tested without hardware or a home-made emulator.
- Real payloads use type names (`device-status`, `device-capabilities`, `device-configurations`, `locations`) and `null` values that the documentation and the official sample do not show, so strict validators written from the docs reject every device sub-resource. Response examples with nulls, or a JSON schema or OpenAPI document, would fix this.
- The sandbox doorbell negotiates a live view session but sends no media unless a live view event simulation is running (we confirmed this: with a Motion simulation we decoded 250 frames at 1280x720), and that is not explained next to the live view docs.
- Subscriptions returns 422 "Unable to process subscription request for this user" for the Playground user instead of an empty list or a documented "not available" error.
- Playground tokens last about 30 minutes with no refresh; ours expired mid-session.
- The `ring-api-helloworld` webhook route does not verify `X-Signature` and its schema is the older payload shape.
- End to end encryption is exposed in configurations, but TAKE mode is not, so apps learn about TAKE only when media comes back unreadable.
- Alexa+ developer tooling is partner-gated, and the documented Alexa+ client initializes with protocol 2025-03-26 while the overview requires 2025-11-25.

**Onboarding experience**

Developer registration and identity verification were quick. Getting from registration to a first real event was the hard part: the docs list "at least one Ring device" as a prerequisite while the hackathon says no device is needed, and the real no-hardware path (Playground for reads and live view, an emulator for events) is only clear after reading forum threads.

**Would we build with these devices and services again?**

Yes. Ring's installed base and signed events make products like VisitProof possible without new hardware. A Playground "send test event" button, a sandbox doorbell that streams sample video, and response examples with nulls would remove most of the friction we hit.

---

## AWS Builder Mini Challenge

VisitProof is written for AWS end to end, and its core backend is deployed. The CDK app in `infra/` runs four stacks in `us-east-1`: `VisitProof-dev-Data`, `VisitProof-dev-Observability`, `VisitProof-dev-Webhook` and `VisitProof-dev-Engine`. All are tagged `Project=visitproof` and were deployed on 22 October 2026 with short-lived `aws login` credentials after a CDK bootstrap.

What we verified end to end on 22 October 2026, using a synthetic Ring v1.1 webhook signed with HMAC-SHA256 over the raw body (no real Ring call):

- API Gateway and Lambda: the signed request returned 202 in 815 ms. Unsigned, wrong-key and tampered-body requests each returned 401, and a repeated request id returned 202 duplicate.
- DynamoDB: the door event and an idempotency receipt with a TTL were stored.
- DynamoDB Streams and Lambda: the Presence Engine event processor ran with 0 errors.
- KMS: the engine appended the first ledger record, signed with ECDSA P-256 by the KMS ledger key.
- EventBridge: the visit sweeper runs every minute with 0 errors.
- CloudWatch, SQS, Budgets: both alarms stayed OK, both DLQs were empty, and actual spend was 0 USD.

| Service | Role in VisitProof | Status |
|---|---|---|
| API Gateway HTTP API and Lambda | Public Ring Webhook URL; verify, dedupe, persist, 202 within Ring's 5 second budget | Deployed and verified |
| DynamoDB single table and Streams | Events, visits, exceptions, EVV, ledger; streams trigger the Presence Engine | Deployed and verified |
| KMS (ECC NIST P-256) | Signs each ledger record with ECDSA SHA-256 | Deployed and verified |
| EventBridge | Visit sweeper every minute, daily digest | Deployed and verified (sweeper) |
| S3 | Snapshots with lifecycle expiry by consent, evidence packs | Deployed, not exercised yet |
| SQS, CloudWatch, SNS, Budgets | Dead letter queues, alarms, 100 USD budget | Deployed; no email subscriber yet |
| Bedrock (Nova 2 Lite, Converse) | Plain-language visit narratives from statuses and times only, with a template fallback | Deployed but blocked: the account's Nova 2 Lite quotas are 0, so calls are throttled and the template is used |
| SES | Daily digest and exception alerts | Code ready and tested, not configured |
| Strands Agents on Bedrock, Cognito, AgentCore Runtime, Amplify | Ask VisitProof brain, sign in, hosted MCP server, hosted console | Not deployed; the console runs locally |

The webhook URL is not registered with Ring yet, so no real Ring traffic reaches AWS. Every adapter is also tested with `aws-sdk-client-mock`, and `createAwsDeps(env)` in `apps/engine/src/aws-deps.ts` switches each one on independently. The estimated cost is about 3 to 5 USD a month. Full status, evidence and teardown steps are in `docs/aws-integrations.md`.

---

## Open Source Mini Challenge

- **Contribution URL:** https://github.com/CodeWithEugene/Amazon-Developer-Hackathon
- **Project repository URL:** https://github.com/CodeWithEugene/Amazon-Developer-Hackathon
- **GitHub username:** CodeWithEugene
- **What we did, how it works, why it matters:** VisitProof is a new Apache-2.0 project created during the hackathon window. Its reusable centerpiece is `packages/ring-partner-sdk`, a typed TypeScript Ring Partner API client, because Ring documents that there is no official SDK. It includes webhook HMAC verification over raw bytes, v1.1 schemas that accept future Ring values, the account-link nonce, a token manager with single-flight refresh, a browser-safe WHEP helper that enforces Ring's session caps and ends a connected session that sends no video, the real Playground responses as fixtures with a mock Ring Playground that serves them, and an emulator that delivers signed webhooks and multi-day scenarios. Any Ring developer can use it to test the event path without hardware, which is the biggest gap we hit. It ships with 132 tests in 14 files, and the rest of the repository shows it in a complete product.

---

## Pre-Existing Project

Not applicable. The repository and all code were created after the submission period opened on 31 August 2026 (first commit 27 September 2026).

---

## Friction Log Summary (Bonus)

Full entries in the required format (task, steps, expected, actual, severity, workaround, suggestion): `docs/friction-log.md`.

Live Ring Playground run on 22 October 2026: entries 1 and 2 reproduced; entry 3 could not be evaluated because the sandbox history is empty; entry 8 corrected (end to end encryption is exposed in configurations, TAKE mode is not); entries 16, 17, and 18 are new from that run. Entry 18 was resolved later that day by triggering a Playground simulation, which produced real video. Entries 5 and 7 are still anticipated: we did not create a Ring app registration or download a snapshot.

| # | Area | Task | Severity | Status |
|---|---|---|---|---|
| 1 | Ring Playground | Drive the webhook path from the sandbox device | High | Reproduced 22 October 2026 |
| 2 | Ring Playground | Keep a token alive during a development session | Medium | Reproduced 22 October 2026 |
| 3 | Ring API docs | Filter event history by type | Medium | Could not be evaluated (sandbox history is empty) |
| 4 | ring-api-helloworld | Verify webhook signatures using the sample | High | Open |
| 6 | Ring docs | Understand the hardware requirement for testing | Medium | Open |
| 8 | Ring encryption | Detect whether a device is TAKE or E2EE encrypted | Low | Corrected 22 October 2026 (E2EE is exposed; TAKE is not) |
| 9 | Alexa+ docs | Reconcile the MCP protocol version across pages | Medium | Open |
| 10 | Alexa+ docs | Reconcile authentication guidance across pages | Medium | Open |
| 12 | AWS Amplify | Confirm Next.js 16 support before choosing hosting | Medium | Open |
| 13 | Ring emulator and engine | Replay the two-week dataset end to end | High | Resolved |
| 16 | Ring API | Parse real device payloads with strict schemas (real type names and nulls not documented) | High | Reproduced 22 October 2026, worked around |
| 17 | Ring API | Read subscriptions as the Playground user (422) | Low | Reproduced 22 October 2026 |
| 18 | Ring Playground | See video in live view from the sandbox doorbell (connected, no media without a simulation) | High | Reproduced and resolved 22 October 2026 |

## Feature Requests

| Priority | Platform | Request | Why |
|---|---|---|---|
| High | Ring Playground | Signed test webhooks to a URL the developer supplies | Makes the event path testable without hardware |
| High | Ring Playground | A sandbox doorbell that streams sample video continuously, or a documented trigger for it | A connected live view with no media looks exactly like a client bug |
| High | Ring API | Response examples that show real type names and every field that can be `null` | Strict validators written from the docs reject every real device payload |
| High | Ring API | Official test vectors for webhook signatures and nonces | Prevents certification failures |
| Medium | Ring API | A JSON schema or OpenAPI document for the Partner API | Partners can generate validators instead of guessing |
| Medium | Ring API | TAKE mode next to `e2e_encryption` on the device resource | Apps can degrade gracefully before requesting media |
| Medium | Ring Playground | Pre-seeded history events of each type on the sandbox doorbell | History parsing and event type filtering cannot be tested on an empty page |
| Medium | Ring API | Server-side event type filtering that matches the docs | Less client-side paging |
| Medium | Ring Developer Console | Secret rotation | Standard OAuth hygiene |
| Medium | Alexa+ | Public conformance checker for MCP add-ons | Everyone is guessing today |
