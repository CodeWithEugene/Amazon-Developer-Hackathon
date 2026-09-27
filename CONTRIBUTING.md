# Contributing to VisitProof

Thank you for helping build proof of presence for home care. This document explains how the repository is organized, how to run it, and what we expect in a pull request. Everything here applies during and after the Build, Ship, Shape: Amazon Developer Hackathon 2026.

## Before You Start

- Read [docs/problem.md](docs/problem.md) and [docs/solution.md](docs/solution.md) so your change fits the product boundaries (agency-first, consent-native, no identity inference, event-first).
- Read [docs/build.md](docs/build.md) for the architecture, the page inventory, and the UI rules (strict shadcn/ui, Title Case for titles and buttons, no dashes in user-facing copy).
- Check open issues and the roadmap section in [README.md](README.md). Comment on an issue before starting large work.

## Prerequisites

- Node.js 22 LTS or later (Node 26 is used in development)
- pnpm 10 or later (`corepack enable && corepack prepare pnpm@latest --activate`)
- An AWS account with the $150 hackathon credits or the new-account free plan (optional for local development; everything runs against fixtures by default)
- A Ring developer account for Playground tokens (optional; the emulator covers every event path)

## Getting Started

```bash
git clone https://github.com/<your-fork>/visitproof.git
cd visitproof
pnpm install
cp .env.example .env.local
pnpm dev
```

`pnpm dev` starts the console, the webhook receiver, the MCP server, and the emulator with a seeded two-week schedule. Open http://localhost:3000 and sign in with the demo accounts printed in the terminal.

Useful scripts:

| Script | What it does |
|---|---|
| `pnpm dev` | Start everything locally with fixtures |
| `pnpm demo` | Replay the judge scenario (on time, late, no-show, early departure, unobservable) |
| `pnpm test` | Unit and integration tests (Vitest) |
| `pnpm test:e2e` | Playwright end-to-end flows |
| `pnpm lint` and `pnpm typecheck` | ESLint and TypeScript |
| `pnpm mcp:conformance` | MCP 2025-11-25 transport and tool conformance checks |
| `pnpm emulator -- --scenario no_show` | Send signed Ring webhooks for one scenario |

## Repository Layout

```
apps/console        Next.js 16 app: scheduler console, family portal, caregiver record
apps/webhooks       Ring webhook receiver (Lambda handler + local server)
apps/mcp            MCP server (Streamable HTTP, spec 2025-11-25) and the Echo simulator
packages/ring-partner-sdk   Typed Ring Partner API client, webhook schemas, WHEP helper, emulator
packages/domain     Visit matching, reconciliation, evidence signing, EVV export
packages/ui         shadcn/ui components and theme shared by the apps
docs/               Hackathon information, research, problem, solution, build spec, friction log
.kiro/              Kiro specs, steering, hooks, and Crew job definitions
```

## Development Workflow

1. Create a branch from `main`: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`.
2. Write or update tests first where practical. Domain logic in `packages/domain` must keep coverage above 80%.
3. Keep functions under 50 lines and files under 500 lines. Extract modules rather than growing them.
4. Never mutate inputs; return new objects.
5. Validate every external input at the boundary with Zod (webhook payloads, API responses, form data, MCP tool arguments).
6. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` before opening a pull request.

## UI Rules

- Only shadcn/ui components from `packages/ui`. Do not hand-roll buttons, inputs, dialogs, or tables. Add a component with `pnpm dlx shadcn@latest add <name>` inside `packages/ui`.
- Colors come only from the theme tokens (`bg-background`, `text-muted-foreground`, `--chart-1`, and so on). No hard-coded hex values.
- Icons from `lucide-react` only.
- Titles, headings, and button labels use Title Case. Body text uses sentence case.
- No em dashes or en dashes in user-facing copy. Rewrite the sentence.
- Every interactive element is keyboard reachable and labeled; the target is WCAG 2.2 AA.

## Commit Messages

Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`. One logical change per commit. Do not add Co-Authored-By trailers.

## Pull Requests

- Fill in the template: what changed, why, how it was tested, screenshots for UI changes, and any friction encountered with Ring, AWS, or MCP tooling (we copy those into `docs/friction-log.md`).
- Link the issue.
- CI must be green (lint, typecheck, unit tests, MCP conformance, build).
- A maintainer reviews within 2 business days during the hackathon window.

## Data and Privacy Rules for Contributors

- Use only the synthetic personas and emulated events in `packages/ring-partner-sdk/fixtures`. Never add real names, addresses, Ring device IDs, tokens, or footage.
- Do not add features that identify people, correlate across Ring accounts, or monitor the care recipient beyond door events.
- Any new data field must have a retention rule and a deletion path.

## Friction Log

If a tool, SDK, API, or document made your task harder than it should have been, add an entry to `docs/friction-log.md` using the hackathon format: task attempted, steps taken, expected result, actual result, severity, workaround, suggestion. These entries are part of our submission and go to the Amazon engineering teams.

## License

By contributing you agree that your contributions are licensed under the Apache License 2.0 in [LICENSE.md](LICENSE.md).
