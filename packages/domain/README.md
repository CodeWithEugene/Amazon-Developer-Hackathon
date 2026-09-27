# @visitproof/domain

Pure TypeScript domain logic for VisitProof. No AWS imports here; everything takes injected `now` and dependencies.

- `src/types.ts` is the shared entity contract (Zod schemas and TypeScript types for Agency, Client, RingIntegration, Device, Caregiver, Visit, DoorEvent, EVVRecord, Exception, LedgerRecord, Note, Snapshot, Tolerances). Other packages import from `@visitproof/domain`.
- Planned modules (see `docs/build.md` Section 6): `presence.ts` (normalizeEvent, findVisitWindow, arrivalCandidates, chooseArrival, detectDeparture, classifyVisit, assessObservability), `reconcile.ts`, `exceptions.ts`, `ledger.ts`, `evidence.ts`, `openevv.ts`, `judgments.ts` (Jev via `@typesafe-ai/sdk`, server side only), `narratives.ts`.

Scripts: `pnpm build`, `pnpm test`, `pnpm test:coverage` (80 percent gate), `pnpm typecheck`, `pnpm lint`.
