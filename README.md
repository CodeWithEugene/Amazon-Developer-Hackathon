# VisitProof

**Proof of presence for home care, from the doorbell already at the door.**

VisitProof is a Ring Appstore app and web console for home-care agencies and the families who employ them. It turns the events a Ring doorbell or camera already produces into an independent, timestamped, tamper-evident record of when a caregiver arrived at and left a client's home, matched against the agency's schedule and the caregiver's own Electronic Visit Verification (EVV) clock-in.

Built for the **Build, Ship, Shape: Amazon Developer Hackathon 2026**. Primary track: Ring. Mini challenges: AWS Builder and Open Source. Secondary: Alexa+ (MCP server over the same backend).

> Status: specification complete, build in progress. See the documents below for the full plan. This README will gain a Judge Quick Start, screenshots, and the demo video link as the build lands.

## Why

- Every Medicaid-funded home-care visit must be electronically verified, and in 2026 states switched to hard edits: claims without a verified visit are denied automatically.
- GPS clock-ins from a caregiver's phone are unreliable, spoofable, and useless when the phone dies.
- Families cannot tell whether the caregiver came, when, or for how long. No-shows are the number one family complaint.
- A Ring doorbell is already at the door, owned by the family, and produces server-signed, timestamped events that cannot be spoofed from a phone.

## What It Does

| For | VisitProof delivers |
|---|---|
| Agency scheduler | A Today board with live visit status and exception cards (late, no-show, early departure, unobservable) raised inside the grace window, with backfill actions |
| Compliance and billing | Reconciliation of every EVV clock-in against the door record (corroborated, contradicted, missing, unobservable), signed evidence records, PDF evidence packs, alternate-EVV JSON export |
| Family | A two-minute Ring link with granular consent, one calm message a day, alerts only on exceptions, optional arrival snapshot with automatic expiry, one-tap export and delete |
| Caregiver | A fair record of their own visits, notes and disputes stored in their own signed column |
| Alexa+ and agents | A spec-exact MCP server (2025-11-25, Streamable HTTP) with voice-first tools such as "did the caregiver come today?" |

Principles: corroboration not surveillance; events first, pixels optional; three columns never merged (observed, reported, resolved); silence is signed; deterministic decisions narrated by AI; one message a day; honest boundaries.

## How It Is Built

- **Ring Partner API:** one-way OAuth account linking, devices, capabilities, configurations, event history, HMAC-signed webhooks, snapshot download, WHEP live view. Playground sandbox for live API calls plus an emulator that sends signed v1.1 webhooks for every scenario.
- **AWS:** Lambda and API Gateway (webhook receiver), DynamoDB, EventBridge Scheduler (visit sweeper), S3 and KMS, SES, Cognito, Amplify Hosting, Bedrock Nova 2 Lite with Guardrails (narratives), Rekognition (non-identifying labels), Bedrock AgentCore Runtime (MCP hosting), Strands Agents (ops copilot), Kiro and Kiro Crew (development).
- **App:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, strictly shadcn/ui (Base UI primitives, Nova style), pnpm and Turborepo monorepo.
- **Judgments:** TypeSafe Jev for bounded typed decisions (which candidate event is the arrival; how to classify a caregiver note).
- **Open source:** Apache-2.0. The `@visitproof/ring-partner-sdk` package (typed client, webhook verifier and schemas, WHEP helper, emulator) is published separately on npm.

## Documents

| Document | What it contains |
|---|---|
| [docs/info.md](docs/info.md) | Everything about the hackathon: tracks, rules, prizes, judging, deadlines, resources, FAQs, checklist |
| [docs/research.md](docs/research.md) | All research: Ring, Alexa+, Fire TV, Bee, AWS, competitors, judges, market and EVV, decision analysis, risks, shadcn/ui |
| [docs/problem.md](docs/problem.md) | The customer problem, personas, market size, existing approaches, boundaries |
| [docs/solution.md](docs/solution.md) | The product: principles, surfaces, user journeys, technical design, UX, business model, compliance, packaging, roadmap |
| [docs/build.md](docs/build.md) | The engineering specification: architecture, repo layout, data model, APIs, pages and components, design system rules, infrastructure, testing, schedule |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to run, test, and contribute |
| [SECURITY.md](SECURITY.md) | How to report a vulnerability |
| [CODE-OF-CONDUCT.md](CODE-OF-CONDUCT.md) | Community standards, including data-handling rules |

## Judge Quick Start (once the build lands)

```bash
pnpm install
pnpm demo
```

Open http://localhost:3000. The demo replays two weeks of emulated, signed Ring webhooks for three clients covering every scenario, seeds EVV records, and offers one-click sign-in as the scheduler, the compliance lead, a family member, and a caregiver. No AWS or Ring credentials are required. With a Ring Playground token in `.env.local`, device checks, history backfill, snapshots, and live view run against the real Ring API.

## Boundaries

VisitProof is not an EVV system of record, not identity verification, not resident monitoring, and not a medical device. It never uses facial recognition, never correlates across Ring accounts, and works fully without any video access.

## License

Apache License 2.0. See [LICENSE.md](LICENSE.md).
