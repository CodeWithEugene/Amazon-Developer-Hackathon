# Devpost Submission Draft

> Paste-ready text for every field of the Build, Ship, Shape submission form. Items marked **TO FILL** depend on steps not done yet (live Ring run, AWS deployment, video upload). Everything else matches the code on `main`. Copy rule for all fields: Title Case headings and button names, no em or en dashes.

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

## Try It Out Links

- Source code: https://github.com/CodeWithEugene/Amazon-Developer-Hackathon (Apache-2.0)

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
- **Ask VisitProof (Alexa+).** "Did the caregiver come to Mom's today?" answered by an MCP server over Streamable HTTP, shown in an Echo Show style simulator with the raw tool call visible.

Principles we held to: corroboration, not surveillance (it says a person arrived at the door, never who); events first, pixels optional (everything works with zero video, so Ring's TAKE encryption does not break it); three columns never merged (Observed, Reported, Resolved); unobservable windows are recorded as unobservable, never as absence.

### How We Built It

**Ring Partner API at runtime**

| Ring capability | Where in the code |
|---|---|
| Typed client: users/me, devices with include, status, capabilities, configurations, location, event history, snapshots (303 flow), clips, WHEP sessions, subscriptions, app integrations (POST nonce confirm, PATCH completed) | `packages/ring-partner-sdk/src/client.ts` |
| Webhook verification: HMAC-SHA256 over the raw body bytes, constant time, v1.1 schemas, dedupe on `meta.request_id`, 202 before any engine work | `packages/ring-partner-sdk/src/webhook.ts`, `apps/webhooks/src/receive.ts` |
| One-way account linking: Token Exchange URL (60 second exchange), Account Link URL (nonce freshness and constant-time match), App Homepage URL | `apps/console/app/api/ring/token-exchange/`, `apps/console/app/link/`, `apps/console/app/ring/` |
| Device Check and Ring history sync (provenance `ring_history`) | `apps/console/lib/ring/device-check.ts`, `apps/console/lib/ring/history-sync.ts` |
| Live view over WHEP with Ring's 30 and 60 second session caps | `packages/ring-partner-sdk/src/whep.ts`, `apps/console/app/family/live/` |
| Emulator: HMAC-signed v1.1 deliveries and a two-week ground-truth plan, because the Playground cannot send webhooks | `packages/ring-partner-sdk/src/emulator/` |

**TO FILL after the live run:** one sentence with what `pnpm ring:smoke` returned against the Playground sandbox doorbell (calls that passed, history event types seen).

**Presence Engine.** A pure, clock-injected TypeScript engine (`packages/domain`) implements twelve EARS requirements: observable windows, arrival clustering, a judge for ambiguous double arrivals, departure revised as events arrive, late, no-show and early-departure cards, an unobservable overlay from device lifecycle events, nearest-visit assignment for overlapping windows, and reconciliation bands at 10 and 30 minutes. Domain coverage is about 99 percent of statements.

**Demo pipeline.** `pnpm demo` seeds one New York agency, three clients, six caregivers, and 84 visits over two weeks, posts 181 signed webhooks (10 duplicated, as Ring's at-least-once delivery does) to the real receiver, replays the real engine handlers in simulated time, imports independent EVV clock-ins from a vendor-style CSV, and checks the outcome against the plan: 9 late, 4 no-shows, 5 early departures, 3 unobservable, 6 contradicted, 8 missing clock-ins.

**AWS.** See the AWS Builder section below.

**MCP and Alexa+.** `apps/mcp` uses the official TypeScript SDK 1.x: tools `get_visit_status`, `list_visits`, `list_exceptions`, `explain_visit`, `get_client_summary`, `acknowledge_exception`, `add_visit_note` (writes confirm through elicitation or a `confirmed` argument, because the documented Alexa+ client does not advertise elicitation), a schedule resource, a `morning_briefing` prompt, version negotiation for 2025-11-25 and 2025-03-26, Origin and Host validation, scoped bearer tokens, and protected-resource metadata. A conformance suite exercises it over real HTTP.

**UI.** Next.js 16 App Router, React 19, Tailwind CSS v4, and strictly shadcn/ui on Base UI primitives, with agency-local times everywhere and WCAG 2.2 AA as the bar.

**Quality.** 576 automated tests (Vitest), GitHub Actions CI, TypeScript strict, Zod at every boundary.

### Challenges We Ran Into

- The Ring Playground gives a live sandbox doorbell but no motion or doorbell events and no webhook delivery, so we built a signed-webhook emulator and kept Playground calls for devices, history, and live view, with provenance labels on every event.
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

### What's Next For VisitProof

Private-app pilots with home-care agencies, Ring Appstore certification (questionnaire drafted in `docs/compliance.md`), alternate-EVV vendor onboarding in Provider Choice states, Cognito sign-in, the MCP server on AgentCore Runtime, and an Echo Show family view through MCP Apps.

### Boundaries

VisitProof is not an EVV system of record, not identity verification, not resident monitoring, and not a medical device. It never uses facial recognition and never correlates across Ring accounts.

---

## Criteria Map

| Criterion | Evidence |
|---|---|
| Tech Implementation | Ring Partner API client, HMAC webhook receiver, account-linking endpoints, WHEP live view, Presence Engine with 12 EARS requirements, signed ledger, 576 tests, CI |
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

If ports 3000, 3101, or 8000 are taken, the demo names the process and stops. Use `PORT`, `WEBHOOK_PORT`, and `MCP_PORT` to change them. Live Ring mode needs a 30 minute Ring Developer Playground token (README, Live Ring Mode).

---

## Product Feedback (Required)

**Tools, APIs, and SDKs used, and for what**

- **Ring Partner API** (`api.amazonvision.com`): devices, status, capabilities, configurations, location, event history, WHEP live view, app integrations, webhook payloads v1.1.
- **Ring Developer Playground**: 30 minute tokens and the sandbox doorbell for Device Check, history, and live view. **TO FILL** with the actual experience.
- **Ring developer documentation and `ring-api-helloworld`**: API reference, account linking, webhook signatures, WHEP browser pattern.
- **Model Context Protocol TypeScript SDK 1.x**: the VisitProof MCP server and the client in Ask VisitProof.
- **AWS CDK, Lambda, API Gateway, DynamoDB, EventBridge, S3, KMS, SES, Bedrock (Nova 2 Lite), Strands Agents SDK**: see AWS Builder below.

**What worked well**

- The Partner API is clean JSON:API with predictable shapes, opaque ids, and clear error codes (303, 416, 425 on media).
- Webhook signing over raw bytes plus a request id for dedupe is exactly what a reliable receiver needs.
- The read-only scope is a feature: families can say yes because the app cannot control anything in their home.
- The MCP TypeScript SDK made a spec-correct Streamable HTTP server straightforward, including version negotiation.

**What needs work**

- The Playground cannot deliver webhooks or produce motion and doorbell events, so the event path cannot be tested without hardware or a home-made emulator.
- Playground tokens last about 30 minutes with no refresh.
- The `ring-api-helloworld` webhook route does not verify `X-Signature` and its schema is the older payload shape.
- Device encryption state (TAKE or E2EE) is not exposed, so apps learn it only when media comes back unreadable.
- Alexa+ developer tooling is partner-gated, and the documented Alexa+ client initializes with protocol 2025-03-26 while the overview requires 2025-11-25.

**Onboarding experience**

Developer registration and identity verification were quick. Getting from registration to a first real event was the hard part: the docs list "at least one Ring device" as a prerequisite while the hackathon says no device is needed, and the real no-hardware path (Playground for reads and live view, an emulator for events) is only clear after reading forum threads.

**Would we build with these devices and services again?**

Yes. Ring's installed base and signed events make products like VisitProof possible without new hardware. A Playground "send test event" button would remove most of the friction we hit.

---

## AWS Builder Mini Challenge

**TO FILL after deployment:** if the stacks are deployed, change "code ready" to "deployed" for the services that ran, and add the stack names, the Bedrock narrative example, and console screenshots.

VisitProof is written for AWS end to end. The CDK app in `infra/` synthesizes four stacks (Data, Observability, Webhook, Engine), all tagged `Project=visitproof`:

| Service | Role in VisitProof | Code |
|---|---|---|
| API Gateway HTTP API and Lambda | Public Ring Webhook URL; verify, dedupe, persist, 202 within Ring's 5 second budget | `apps/webhooks/src/lambda.ts`, `infra/lib/webhook-stack.ts` |
| DynamoDB single table and Streams | Store for events, visits, exceptions, EVV, ledger; streams trigger the Presence Engine with batch item failures | `packages/db/src/dynamo-repository.ts`, `apps/engine/src/lambda/event-processor.ts` |
| EventBridge | Visit sweeper every minute and the daily family digest | `infra/lib/engine-stack.ts` |
| KMS (ECC NIST P-256) | Signs each ledger record with ECDSA SHA-256 | `apps/engine/src/adapters/ledger-signers.ts` |
| S3 | Snapshots with lifecycle expiry by consent, evidence packs | `apps/engine/src/adapters/ring-snapshot-service.ts` |
| SES | Daily digest and exception alerts | `apps/engine/src/adapters/ses-mailer.ts` |
| Bedrock (Nova 2 Lite, Converse) with Guardrails | Plain-language visit narratives from statuses and times only, validated, with a template fallback | `apps/engine/src/adapters/bedrock-narrator.ts` |
| Strands Agents on Bedrock | The Ask VisitProof brain, calling the VisitProof MCP server | `apps/copilot/src/ask/strands-brain.ts` |
| SQS, CloudWatch, SNS, Budgets | Dead letter queues, alarms, and a 100 USD budget with alerts | `infra/lib/observability-stack.ts` |

Every adapter is tested with `aws-sdk-client-mock`; `createAwsDeps(env)` in `apps/engine/src/aws-deps.ts` switches each one on independently. Full details: `docs/aws-integrations.md`.

---

## Open Source Mini Challenge

- **Contribution URL:** https://github.com/CodeWithEugene/Amazon-Developer-Hackathon
- **Project repository URL:** https://github.com/CodeWithEugene/Amazon-Developer-Hackathon
- **GitHub username:** CodeWithEugene
- **What we did, how it works, why it matters:** VisitProof is a new Apache-2.0 project created during the hackathon window. Its reusable centerpiece is `packages/ring-partner-sdk`, a typed TypeScript Ring Partner API client, because Ring documents that there is no official SDK. It includes webhook HMAC verification over raw bytes, v1.1 schemas that accept future Ring values, the account-link nonce, a token manager with single-flight refresh, a browser-safe WHEP helper that enforces Ring's session caps, and an emulator that delivers signed webhooks and multi-day scenarios. Any Ring developer can use it to test the event path without hardware, which is the biggest gap we hit. It ships with 94 tests, and the rest of the repository shows it in a complete product.

---

## Pre-Existing Project

Not applicable. The repository and all code were created after the submission period opened on 31 August 2026 (first commit 27 September 2026).

---

## Friction Log Summary (Bonus)

Full entries in the required format (task, steps, expected, actual, severity, workaround, suggestion): `docs/friction-log.md`.

**TO FILL after the live Ring run:** update the status of entries 1, 2, 3, 5, 7, and 8 from "Anticipated" to what actually happened.

| # | Area | Task | Severity |
|---|---|---|---|
| 1 | Ring Playground | Drive the webhook path from the sandbox device | High |
| 2 | Ring Playground | Keep a token alive during a development session | Medium |
| 3 | Ring API docs | Filter event history by type | Medium |
| 4 | ring-api-helloworld | Verify webhook signatures using the sample | High |
| 6 | Ring docs | Understand the hardware requirement for testing | Medium |
| 8 | Ring encryption | Detect whether a device is TAKE or E2EE encrypted | Medium |
| 9 | Alexa+ docs | Reconcile the MCP protocol version across pages | Medium |
| 10 | Alexa+ docs | Reconcile authentication guidance across pages | Medium |
| 12 | AWS Amplify | Confirm Next.js 16 support before choosing hosting | Medium |
| 13 | Ring emulator and engine | Replay the two-week dataset end to end | High |

## Feature Requests

| Priority | Platform | Request | Why |
|---|---|---|---|
| High | Ring Playground | Signed test webhooks to a URL the developer supplies | Makes the event path testable without hardware |
| High | Ring API | Encryption state on the device resource | Apps can degrade gracefully before requesting media |
| High | Ring API | Official test vectors for webhook signatures and nonces | Prevents certification failures |
| Medium | Ring API | Server-side event type filtering that matches the docs | Less client-side paging |
| Medium | Ring Developer Console | Secret rotation | Standard OAuth hygiene |
| Medium | Alexa+ | Public conformance checker for MCP add-ons | Everyone is guessing today |
