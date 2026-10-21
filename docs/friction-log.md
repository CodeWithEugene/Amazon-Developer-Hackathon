# Friction Log

> Format required by the hackathon for the up-to-10% judging bonus: task attempted, steps taken, expected result, actual result, severity, workaround, actionable suggestion. Entries are added as they happen; the summary table is pasted into the Devpost submission. Severity scale: Blocker (could not proceed), High (lost more than an hour or changed the design), Medium (lost under an hour), Low (annoyance).

## Summary Table

| # | Area | Task | Severity | Status |
|---|---|---|---|---|
| 1 | Ring Playground | Drive the webhook path from the sandbox device | High | Anticipated, not yet reproduced |
| 2 | Ring Playground | Keep a token alive during a development session | Medium | Anticipated, not yet reproduced |
| 3 | Ring API docs | Filter event history by type | Medium | Anticipated, not yet reproduced |
| 4 | ring-api-helloworld | Verify webhook signatures using the sample | High | Open |
| 5 | Ring Developer Console | Recover credentials after closing the creation dialog | Medium | Anticipated, not yet reproduced |
| 6 | Ring docs | Understand the hardware requirement for testing | Medium | Open |
| 7 | Ring media | Size the watermark band for computer vision | Low | Anticipated, not yet reproduced |
| 8 | Ring encryption | Detect whether a device is TAKE or E2EE encrypted | Medium | Anticipated, not yet reproduced |
| 9 | Alexa+ docs | Reconcile the MCP protocol version across pages | Medium | Open |
| 10 | Alexa+ docs | Reconcile authentication guidance across pages | Medium | Open |
| 11 | AWS AgentCore | Install the CLI when the older Python CLI is present | Low | Anticipated, not yet reproduced |
| 12 | AWS Amplify | Confirm Next.js 16 support before choosing hosting | Medium | Open |
| 13 | Ring emulator + Presence Engine | Replay the two-week dataset end to end | High | Resolved |
| 14 | shadcn/ui | Ship the specced initial component set | Low | Resolved |
| 15 | Spec drift | Align assurance and deletion copy with actual code | Medium | Resolved |

## Entries

### 1. Ring Playground: drive the webhook path from the sandbox device

- **Status:** Anticipated, not yet reproduced. No Playground token has been used in this repository yet (no calls, no recorded fixtures). The steps above are the planned reproduction; the finding comes from the Playground documentation and the Devpost forum.
- **Task attempted:** Use the Playground sandbox doorbell to generate `motion_detected` and `button_press` webhooks so the visit-matching engine could be exercised against real Ring deliveries.
- **Steps taken:** Generated a Playground token, listed devices, queried `GET /v1/history/devices/{id}/events`, opened a WHEP session, waited for events, checked the Devpost forum thread on the Playground for non-US entrants.
- **Expected:** Simulated motion or doorbell events (the release notes for 28 May 2026 mention "event simulation") delivered to a registered webhook URL, or at least visible in history.
- **Actual:** History shows only `on_demand` entries created by our own live-view sessions; no motion or doorbell events exist; Playground sessions have no webhook URL so nothing can be delivered to a local or hosted endpoint.
- **Severity:** High. It changed the architecture: we built a TypeScript emulator that signs and delivers v1.1 webhooks so the event path could be tested at all.
- **Workaround:** Emulator with HMAC-signed payloads and scenario replay; Playground used only for device metadata, history, snapshots, and live view; provenance labels on every event in the UI.
- **Suggestion:** Add a "Send test event" control to the Playground that emits signed `motion_detected` (with `sub_type`) and `button_press` webhooks to a URL the developer pastes in, and let the sandbox device carry a few pre-seeded history events of each type.

### 2. Ring Playground: keep a token alive during a development session

- **Status:** Anticipated, not yet reproduced. No Playground session has been run yet, so the 30 minute expiry has not been hit in practice. The expiry is documented; the steps above are the planned reproduction.
- **Task attempted:** Run a two-hour development session against the Playground.
- **Steps taken:** Generated a token, stored it in `.env`, worked, hit 401 after about 30 minutes, regenerated, repeated.
- **Expected:** A refresh token or a longer-lived development token.
- **Actual:** Access tokens expire after about 30 minutes with no refresh path; every expiry interrupts work and breaks long-running scripts such as history backfills.
- **Severity:** Medium.
- **Workaround:** Token provider prompts for a new token and pauses queued requests; scripts checkpoint cursors so they resume.
- **Suggestion:** Offer a 24-hour developer token in the Playground, or a refresh token scoped to the sandbox device.

### 3. Ring API docs: filter event history by type

- **Status:** Anticipated, not yet reproduced. The history call has not been made against the Playground yet. The finding comes from the documentation and forum reports; the steps above are the planned reproduction.
- **Task attempted:** Retrieve only human motion events with `event_types`.
- **Steps taken:** Called `GET /v1/history/devices/{id}/events?event_types=motion.human` per the documentation; compared with an unfiltered call; read the forum correction from Amazon staff about plural syntax.
- **Expected:** Only `motion.human` events.
- **Actual:** The response appears unfiltered (also reported by another entrant); the documented parameter name and syntax did not match staff guidance until corrected in the forum.
- **Severity:** Medium.
- **Workaround:** Client-side filtering in the SDK; documented in the README.
- **Suggestion:** Fix the parameter documentation with a working example and return a 400 with a helpful message when the filter syntax is wrong instead of silently ignoring it.

### 4. ring-api-helloworld: verify webhook signatures using the sample

- **Task attempted:** Reuse the official sample's webhook handling as a reference for signature verification and payload shape.
- **Steps taken:** Read `app/api/webhook/route.ts` and `lib/schemas/webhook.ts`; compared with the Notifications documentation.
- **Expected:** HMAC-SHA256 verification over the raw body with the `X-Signature` header, and the v1.1 payload schema.
- **Actual:** The sample checks a static bearer token that Ring does not send, and its Zod schema describes an older 1.0 shape with `confidence` and `bounding_box` fields that real deliveries do not contain.
- **Severity:** High for anyone who copies it; it would fail certification and drop real events.
- **Workaround:** Implemented verification and schemas from the documentation in our SDK; added a test vector set.
- **Suggestion:** Update the sample to verify `X-Signature` over raw bytes and to use the v1.1 schema; publish official test vectors (body plus key plus expected signature).

### 5. Ring Developer Console: recover credentials after closing the creation dialog

- **Status:** Anticipated, not yet reproduced. The credential behavior is taken from the Ring documentation (docs/research.md Section 2); the console steps above have not been reproduced in this project.
- **Task attempted:** Retrieve the HMAC signing key after the app creation dialog was dismissed.
- **Steps taken:** Looked in the app settings; read the docs stating credentials are shown once and cannot be regenerated.
- **Expected:** A "rotate secret" or "reveal once more" action.
- **Actual:** The only path before certification is to delete the app and create a new one.
- **Severity:** Medium.
- **Workaround:** Copy credentials to a password manager during creation; document this in CONTRIBUTING.
- **Suggestion:** Add secret rotation to the console (standard for OAuth providers).

### 6. Ring docs: understand the hardware requirement for testing

- **Task attempted:** Decide whether a physical device was required.
- **Steps taken:** Read the Get Started prerequisites ("at least one Ring device"), the hackathon page ("no physical device required"), the FAQ, and the forum.
- **Expected:** One consistent answer with a documented no-hardware path.
- **Actual:** The docs and the hackathon copy disagree; the real answer (Playground for reads and live view, emulator for events, real device plus paid plan plus support-provisioned trial for staging) only emerges from forum threads.
- **Severity:** Medium.
- **Workaround:** Documented the three paths in `docs/research.md` Section 2.4.
- **Suggestion:** A "Testing without a device" page in the docs that states exactly what the Playground can and cannot do.

### 7. Ring media: size the watermark band for computer vision

- **Status:** Anticipated, not yet reproduced. No Playground frame has been downloaded yet, so nothing has been measured. The steps above are the planned reproduction.
- **Task attempted:** Crop the watermark before running label detection on a snapshot.
- **Steps taken:** Downloaded a Playground frame; measured the band manually.
- **Expected:** Documented pixel dimensions or a ratio for the watermark overlay.
- **Actual:** The release note says "fixed-pixel-size" but gives no numbers; the relative footprint changes with resolution.
- **Severity:** Low.
- **Workaround:** Crop the top 15% by default with a configurable ratio.
- **Suggestion:** Document the watermark geometry per resolution, or expose it in the media response headers.

### 8. Ring encryption: detect whether a device is TAKE or E2EE encrypted

- **Status:** Anticipated, not yet reproduced. Device status and capabilities have not been inspected against the Playground yet. The finding comes from the encryption documentation; the steps above are the planned reproduction.
- **Task attempted:** Decide up front whether snapshots for a device will be readable.
- **Steps taken:** Inspected device status and capabilities; read the encryption documentation added on 16 September 2026.
- **Expected:** A device attribute for encryption state.
- **Actual:** TAKE devices return encrypted bytes from media endpoints; E2EE devices are absent from the device list; the status flag is described as "coming."
- **Severity:** Medium.
- **Workaround:** Treat undecodable media as an "encrypted device" observability reason and keep every feature event-only.
- **Suggestion:** Ship the encryption attribute on the device resource and a webhook when it changes.

### 9. Alexa+ docs: reconcile the MCP protocol version across pages

- **Task attempted:** Build an MCP server that Alexa+ would accept.
- **Steps taken:** Read the MCP Toolkit overview (requires 2025-11-25), the client lifecycle page (client initializes with `2025-03-26` and declares only `roots`).
- **Expected:** One version and one capability set.
- **Actual:** Two versions on two pages; no elicitation, sampling, or tasks advertised by the documented client.
- **Severity:** Medium.
- **Workaround:** Version negotiation for both; confirmations implemented with a `confirmed` argument fallback in addition to elicitation.
- **Suggestion:** Publish the exact `initialize` payload Alexa+ sends today and update the overview to match.

### 10. Alexa+ docs: reconcile authentication guidance across pages

- **Task attempted:** Implement authentication for an MCP add-on.
- **Steps taken:** Read the QuickStart (bare 401, metadata at `/.well-known/oauth-authorization-server`), the account-linking page (RFC 9728 metadata at `/.well-known/oauth-protected-resource`, no dynamic client registration), and the authentication page (two-tier client credentials plus authorization code).
- **Expected:** A single reference flow.
- **Actual:** Three pages with overlapping but different requirements.
- **Severity:** Medium.
- **Workaround:** Serve both well-known documents, static client, PKCE S256, refresh tokens, 401 without relying on `WWW-Authenticate`.
- **Suggestion:** One authentication page with a sequence diagram and a conformance checker.

### 11. AWS AgentCore: install the CLI when the older Python CLI is present

- **Status:** Anticipated, not yet reproduced. The AgentCore CLI has not been installed for this project yet (AgentCore hosting is planned, not built). The steps above are the planned reproduction.
- **Task attempted:** Install the npm `@aws/agentcore` CLI.
- **Steps taken:** Ran `agentcore --help`; the older Python `bedrock-agentcore-starter-toolkit` binary shadowed the new one.
- **Expected:** A clear migration note.
- **Actual:** Confusing command differences until the Python package was uninstalled.
- **Severity:** Low.
- **Workaround:** `pip uninstall bedrock-agentcore-starter-toolkit`.
- **Suggestion:** Print a deprecation banner from the Python CLI pointing at the npm CLI.

### 12. AWS Amplify: confirm Next.js 16 support before choosing hosting

- **Task attempted:** Choose a host for a Next.js 16 App Router console.
- **Steps taken:** Read the Amplify SSR support page (states support "up through Next.js 15" as of mid-2026); noted App Runner stopped accepting new customers on 30 April 2026.
- **Expected:** Current framework support stated for the current Next.js major.
- **Actual:** Ambiguous support; we must test-deploy in week one and keep a fallback.
- **Severity:** Medium.
- **Workaround:** Test deploy early; fallback to ECS Express Mode or Vercel for the console while keeping the backend on AWS.
- **Suggestion:** Publish a framework support matrix with dates and a compatibility badge.

### 13. Ring emulator + Presence Engine: replay the two-week dataset end to end

- **Task attempted:** Seed the demo by posting the emulator's `two_weeks` signed deliveries to the real webhook receiver and running the Presence Engine (`processEvent` + `sweepVisits`) over the persisted events, expecting the scripted outcome (62 on time, 9 late, 4 no-show, 5 early departures, 3 unobservable, 1 double visitor).
- **Steps taken:** Replayed the window in simulated time against the local repository, then compared final visit statuses, exception cards, and reconciliation outcomes with the scripted per-visit expectations.
- **Expected:** Statuses and exception cards match the scripted composition.
- **Actual:** Two mismatches, both invisible to the packages' unit tests. (a) The emulator emitted events client by client, so its monotonic-timestamp high-water mark dragged the second and third clients' events out of their visit windows; 54 of 84 visits saw no door events at all. (b) The scenario scripts emitted a human-motion event 30 seconds after every arrival; the engine's quiet-period rule (`detectDeparture`) pins the last signal as the departure once the door is quiet for `departureQuietMin`, so all 77 visits with an observed arrival ended `early_departure` roughly 10 minutes after the caregiver walked in.
- **Severity:** High. It was caught only because the demo replays the whole pipeline and diffs outcomes; every package-level test suite was green while the integrated result was wrong.
- **Workaround:** Emit the dataset in global time order, and model front-door motion realistically: the doorbell press is the arrival and the next front-door human motion is the departure (no "entered the house" motion 30 seconds after arrival).
- **Suggestion:** Add an in-window assertion to the emulator's replay test (every scripted visit's deliveries must land inside its visit window), and document the quiet-period rule's event-density assumption where `detectDeparture` is specified, since sparse event streams silently produce early-departure verdicts.

### 14. shadcn/ui: ship the specced initial component set

- **Task attempted:** Build the console on the shadcn "initial set" listed in the build spec (about 46 components added in one CLI pass) so every planned screen would have its primitives ready.
- **Steps taken:** Added the full set per the spec, built the four role surfaces, then audited usage during a review pass by grepping `apps/console` imports and walking transitive component dependencies.
- **Expected:** Most of the set earns its place.
- **Actual:** 32 of 52 components (about 4,800 of 6,500 lines, including a 723-line `sidebar.tsx`) were never imported by any surface. Nothing in the CLI or the toolchain flags unused registry files: they typecheck, lint, and sit in the package silently.
- **Severity:** Low. No runtime cost with per-file imports, but review noise and a maintenance surface that looks load-bearing.
- **Workaround:** Computed the used set (19 direct imports plus 1 transitive) and deleted the rest; hooks and utils stay.
- **Suggestion:** Add components per screen as needed instead of bulk-installing a speculative set; a tiny CI script that diffs the components directory against import sites would have caught this at add time.

### 15. Spec drift: align assurance and deletion copy with actual code

- **Task attempted:** Ship the family "Delete Everything" action and the compliance assurance copy exactly as written in the spec and certification draft.
- **Steps taken:** Implemented the delete route against the repository interface, which in demo mode only supports a tombstone (link removed, consent withdrawn); the fix-pass review then compared user-facing copy with the code paths that actually run.
- **Expected:** Copy and behavior agree.
- **Actual:** Three mismatches, none caught by tests. (a) The delete dialog claimed it "permanently removes all visits, notes, and evidence... cannot be undone" while the store tombstones; the interface has no hard-delete path. (b) The compliance page footer claimed "Chain verified, ECDSA P-256 signatures" where no verification ran and the signer is a local HMAC stand-in. (c) A "Call Caregiver" action on the Today board never rendered because `caregiverMobile` was never populated.
- **Severity:** Medium. Each instance is a small trust break with judges, and the deletion claim would be a real problem in a Ring certification questionnaire.
- **Workaround:** Rewrote the dialog to describe the tombstone behavior honestly, wired the domain's `verifyChain` into the render path with an explicit "HMAC stand-in for the demo; KMS ECDSA P-256 in production" label, and populated `caregiverMobile` from the caregiver record.
- **Suggestion:** Review destructive and assurance copy ("delete", "permanent", "verified", "signed") against the repository interface and the code that executes, not the product intent; add a claims-audit item to the review checklist.

## Feature Requests

| Priority | Platform | Request | Why |
|---|---|---|---|
| High | Ring Playground | Signed test webhooks to a developer-supplied URL | Makes the event path testable without hardware |
| High | Ring API | Encryption state on the device resource | Lets apps degrade gracefully before requesting media |
| High | Ring API | Official test vectors for webhook signatures and nonces | Prevents certification failures |
| Medium | Ring API | Server-side `event_types` filtering that works as documented | Reduces client-side paging |
| Medium | Ring Developer Console | Secret rotation | Standard OAuth hygiene |
| Medium | Alexa+ | Public conformance checker for MCP add-ons | Everyone is guessing today |
| Low | Ring API | Watermark geometry in media headers | Reliable cropping for vision |
