# @visitproof/domain

Pure TypeScript domain logic for VisitProof. No AWS imports here; everything takes injected `now` and dependencies.

- `src/types.ts`: the shared entity contract (Zod schemas and types). Other packages import from `@visitproof/domain`.
- `src/time.ts`: agency time zone helpers (contract C1): `formatLocalTime` ("8:04 AM ET"), `formatLocalDate`, `localDateKey` (YYYY-MM-DD in the agency zone), `zoneAbbreviation`, `zonedTimeToIso`.
- Presence Engine (`.kiro/specs/presence-engine/requirements.md`):
  - `window.ts`: visit windows; events in overlapping windows go to the nearest visit.
  - `arrival.ts`: candidates, 5 minute clusters, the `ArrivalJudge` port. `ruleJudge` is the deterministic fallback and is labeled `rule` in evidence; an injected Jev adapter is labeled `jev`. Clusters more than 20 minutes apart before start + grace go to the judge, and confidence below 0.7 is ambiguous.
  - `departure.ts`: the last human event after arrival followed by the quiet period, revised as later in-window events arrive. Early departure is judged only when the window closes.
  - `observability.ts`: the unobservable overlay from lifecycle events, `ringLinkStatus`, and device state.
  - `evaluate.ts`: one engine step per visit, shared by `processEvent` and `sweepVisits` (`engine.ts`).
  - `exceptions.ts`: idempotent cards (`visit.raisedExceptionKinds`) and system resolutions with reasons.
  - `reconcile.ts`: EVV against door evidence; manual boundaries never corroborate (contract C2).
- `ledger.ts`: canonical JSON (code point key order), signed hash chain (ledger v2 signs `at` and `signerKeyId`; legacy v1 records still verify).
- `openevv.ts`: an "Open EVV style" export modeled on the Sandata Open EVV visit segment, with the field mapping documented in the file. Not a certified submission format.
- `evidence.ts`, `narratives.ts`: evidence packs and template narratives (pass `{ timeZone }` for agency-local times).

Scripts: `pnpm build`, `pnpm test`, `pnpm test:coverage` (80 percent gate on statements, branches, functions, and lines), `pnpm typecheck`, `pnpm lint`.
