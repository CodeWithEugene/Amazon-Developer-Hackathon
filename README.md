# VisitProof

**Proof of presence for home care, from the doorbell already at the door.**

VisitProof is a Ring Appstore app and web console for home-care agencies and the families who employ them. It turns the events a Ring doorbell or camera already produces into an independent, timestamped, tamper-evident record of when a caregiver arrived at and left a client's home, matched against the agency's schedule and the caregiver's own Electronic Visit Verification (EVV) clock-in.

Built for the **Build, Ship, Shape: Amazon Developer Hackathon 2026**. Primary track: Ring. Mini challenges: AWS Builder and Open Source. Secondary: Alexa+ (MCP server over the same backend).

> Status: the offline demo runs end to end with one command. See [Judge Quick Start](#judge-quick-start) below; the documents further down carry the full plan.

## Why

- Every Medicaid-funded home-care visit must be electronically verified, and in 2026 states switched to hard edits: claims without a verified visit are denied automatically.
- GPS clock-ins from a caregiver's phone are unreliable, spoofable, and useless when the phone dies.
- Families cannot tell whether the caregiver came, when, or for how long. No-shows are the number one family complaint.
- A Ring doorbell is already at the door, owned by the family, and produces server-signed, timestamped events that cannot be spoofed from a phone.

## What It Does

| For                    | VisitProof delivers                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agency scheduler       | A Today board with live visit status and exception cards (late, no-show, early departure, unobservable) raised inside the grace window, with backfill actions                                                                                                                                                                                |
| Compliance and billing | Reconciliation of every EVV clock-in against the door record (corroborated, contradicted, missing, unobservable), signed evidence records, PDF evidence packs, alternate-EVV JSON export. The demo PDF is a minimal single-page rendering (52-line cap, hand-built PDF 1.4); `@react-pdf/renderer` evidence packs are planned for production |
| Family                 | A two-minute Ring link with granular consent, one calm message a day, alerts only on exceptions, optional arrival snapshot with automatic expiry, one-tap export and delete                                                                                                                                                                  |
| Caregiver              | A fair record of their own visits, notes and disputes stored in their own signed column                                                                                                                                                                                                                                                      |
| Alexa+ and agents      | A spec-exact MCP server (2025-11-25, Streamable HTTP) with voice-first tools such as "did the caregiver come today?"                                                                                                                                                                                                                         |

Principles: corroboration not surveillance; events first, pixels optional; three columns never merged (observed, reported, resolved); silence is signed; deterministic decisions narrated by AI; one message a day; honest boundaries.

## How It Is Built

- **Ring Partner API:** one-way OAuth account linking, devices, capabilities, configurations, event history, HMAC-signed webhooks, snapshot download, WHEP live view. Playground sandbox for live API calls plus an emulator that sends signed v1.1 webhooks for every scenario.
- **AWS:** Lambda and API Gateway (webhook receiver), DynamoDB, EventBridge Scheduler (visit sweeper), S3 and KMS, SES, Cognito, Amplify Hosting, Bedrock Nova 2 Lite with Guardrails (narratives), Rekognition (non-identifying labels), Bedrock AgentCore Runtime (MCP hosting), Strands Agents (ops copilot), Kiro and Kiro Crew (development).
- **App:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, strictly shadcn/ui (Base UI primitives, Nova style), pnpm and Turborepo monorepo.
- **Judgments:** bounded decisions (which candidate event is the arrival) sit behind an injectable `ArrivalJudge` port in the domain engine; the demo runs the deterministic rule judge, which picks the candidate closest to the scheduled start. TypeSafe Jev integration behind the same port is planned.
- **Open source:** Apache-2.0. The `@visitproof/ring-partner-sdk` package (typed client, webhook verifier and schemas, WHEP helper, emulator) is packaged for separate npm publication.

## Documents

| Document                                 | What it contains                                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [docs/info.md](docs/info.md)             | Everything about the hackathon: tracks, rules, prizes, judging, deadlines, resources, FAQs, checklist                                                    |
| [docs/research.md](docs/research.md)     | All research: Ring, Alexa+, Fire TV, Bee, AWS, competitors, judges, market and EVV, decision analysis, risks, shadcn/ui                                  |
| [docs/problem.md](docs/problem.md)       | The customer problem, personas, market size, existing approaches, boundaries                                                                             |
| [docs/solution.md](docs/solution.md)     | The product: principles, surfaces, user journeys, technical design, UX, business model, compliance, packaging, roadmap                                   |
| [docs/build.md](docs/build.md)           | The engineering specification: architecture, repo layout, data model, APIs, pages and components, design system rules, infrastructure, testing, schedule |
| [CONTRIBUTING.md](CONTRIBUTING.md)       | How to run, test, and contribute                                                                                                                         |
| [SECURITY.md](SECURITY.md)               | How to report a vulnerability                                                                                                                            |
| [CODE-OF-CONDUCT.md](CODE-OF-CONDUCT.md) | Community standards, including data-handling rules                                                                                                       |

## Judge Quick Start

```bash
pnpm install
pnpm demo
```

Open http://localhost:3000 and sign in with one click as the **Scheduler**, the **Compliance Lead**, a **Family Member**, or a **Caregiver**. No AWS or Ring credentials are required. Ctrl+C stops the demo.

`pnpm demo` replays the whole pipeline locally, against the same code that runs in production:

1. Creates a fresh local repository (`.demo-data/`, git-ignored) and seeds one agency, three clients (Okoro, Nakamura, Alvarez), six caregivers, three Ring account links, and 84 scheduled visits spread over the last 14 days, with the final day always being today so the Today board is populated.
2. Starts the real webhook receiver (`apps/webhooks`) and POSTs 161 emulator-generated, HMAC-signed Ring v1.1 webhook deliveries to it over HTTP; every delivery is signature-verified and deduplicated, and the resulting door events are persisted.
3. Runs the Presence Engine (`processEvent` + `sweepVisits` from `packages/domain`) over the window. Final outcome: 72 visits completed (62 on time, 9 late arrivals, 1 double-visitor visit that the arrival rules attribute to the doorbell press), 5 early departures, 4 no-shows, and 3 unobservable windows (device offline, encrypted device, integration removed). 21 exception cards stay open on the Today board: 9 late arrivals, 4 no-shows, 5 early departures, 3 unobservable.
4. Seeds 69 EVV clock-ins and reconciles every visit: 63 corroborated, 6 contradicted, 8 missing clock-ins, 4 missing both, 3 unobservable.
5. Appends the signed, hash-chained evidence ledger per client (a local HMAC signer stands in for KMS ECDSA P-256; the chains verify with the domain's `verifyChain`) and generates the template visit narratives.
6. Starts the console on http://localhost:3000 against the seeded store.

Things to try: resolve or snooze exception cards on the Today board, backfill a visit, download the evidence pack PDF and the Alternate EVV JSON export from the Compliance page, read the family feed, and add a note on the caregiver record. Backfills, exception resolutions, and notes append to the signed ledger; snoozes, consent changes, and family data deletion are state-only and are not ledger-signed in the demo.

With a Ring Playground token in `.env.local`, device checks, history backfill, snapshots, and live view run against the real Ring API.

## Boundaries

VisitProof is not an EVV system of record, not identity verification, not resident monitoring, and not a medical device. It never uses facial recognition, never correlates across Ring accounts, and works fully without any video access.

## License

Apache License 2.0. See [LICENSE.md](LICENSE.md).
