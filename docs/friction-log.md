# Friction Log

> Format required by the hackathon for the up-to-10% judging bonus: task attempted, steps taken, expected result, actual result, severity, workaround, actionable suggestion. Entries are added as they happen; the summary table is pasted into the Devpost submission. Severity scale: Blocker (could not proceed), High (lost more than an hour or changed the design), Medium (lost under an hour), Low (annoyance).

## Summary Table

| # | Area | Task | Severity | Status |
|---|---|---|---|---|
| 1 | Ring Playground | Drive the webhook path from the sandbox device | High | Reproduced 22 October 2026 |
| 2 | Ring Playground | Keep a token alive during a development session | Medium | Reproduced 22 October 2026 |
| 3 | Ring API docs | Filter event history by type | Medium | Partly evaluated 22 October 2026 (history now returns our own on_demand events; timestamps are epoch ms, undocumented) |
| 4 | ring-api-helloworld | Verify webhook signatures using the sample | High | Open |
| 5 | Ring Developer Console | Recover credentials after closing the creation dialog | Medium | Anticipated, not yet reproduced |
| 6 | Ring docs | Understand the hardware requirement for testing | Medium | Open |
| 7 | Ring media | Size the watermark band for computer vision | Low | Anticipated, not yet reproduced |
| 8 | Ring encryption | Detect whether a device is TAKE or E2EE encrypted | Low | Corrected 22 October 2026 (E2EE is exposed; TAKE is not) |
| 9 | Alexa+ docs | Reconcile the MCP protocol version across pages | Medium | Open |
| 10 | Alexa+ docs | Reconcile authentication guidance across pages | Medium | Open |
| 11 | AWS AgentCore | Install the CLI when the older Python CLI is present | Low | Anticipated, not yet reproduced |
| 12 | AWS Amplify | Confirm Next.js 16 support before choosing hosting | Medium | Open |
| 13 | Ring emulator + Presence Engine | Replay the two-week dataset end to end | High | Resolved |
| 14 | shadcn/ui | Ship the specced initial component set | Low | Resolved |
| 15 | Spec drift | Align assurance and deletion copy with actual code | Medium | Resolved |
| 16 | Ring API | Parse real device payloads with strict schemas | High | Reproduced 22 October 2026, worked around |
| 17 | Ring API | Read subscriptions as the Playground user | Low | Reproduced 22 October 2026 |
| 18 | Ring Playground | See video in live view from the sandbox doorbell | High | Reproduced and resolved 22 October 2026 |

## Entries

### 1. Ring Playground: drive the webhook path from the sandbox device

- **Status:** Reproduced 22 October 2026 (about 00:43 UTC) against `https://api.amazonvision.com` with a Playground token. The response bodies are committed in `packages/ring-partner-sdk/src/fixtures/playground/`.
- **Task attempted:** Use the Playground sandbox doorbell to generate `motion_detected` and `button_press` webhooks so the visit-matching engine could be exercised against real Ring deliveries.
- **Steps taken:** Minted a Playground token, called `GET /v1/users/me` and `GET /v1/devices` (one shared device, "Playground Device", a doorbell), called `GET /v1/history/devices/{id}/events` with and without `event_types`, opened a WHEP live view session, and looked for any place in the Playground to register a webhook URL.
- **Expected:** Simulated motion or doorbell events (the release notes for 28 May 2026 mention "event simulation") delivered to a registered webhook URL, or at least visible in history.
- **Actual:** History returned 200 with `data: []` on every call, with or without the filter: no motion, doorbell, or `on_demand` entries. A Playground session has no webhook URL, so nothing can be delivered to a local or hosted endpoint.
- **Severity:** High. It changed the architecture: we built a TypeScript emulator that signs and delivers v1.1 webhooks so the event path could be tested at all.
- **Workaround:** Emulator with HMAC-signed payloads and scenario replay; Playground used only for device metadata, history, and live view; provenance labels on every event in the UI.
- **Suggestion:** Add a "Send test event" control to the Playground that emits signed `motion_detected` (with `sub_type`) and `button_press` webhooks to a URL the developer pastes in, and let the sandbox device carry a few pre-seeded history events of each type.

### 2. Ring Playground: keep a token alive during a development session

- **Status:** Reproduced 22 October 2026. The token lasted about 30 minutes, came with no refresh token, and expired during our session while we were still debugging the schema and live view problems in entries 16 and 18.
- **Task attempted:** Run a multi-hour development session against the Playground.
- **Steps taken:** Minted a token, saved it to `.env` with `pnpm ring:token`, ran `pnpm ring:smoke` and the console in live mode, then kept working on the failures it found.
- **Expected:** A refresh token or a longer-lived development token.
- **Actual:** The access token expires after about 30 minutes with no refresh path. Every fix after expiry needs a new token, and anything left unverified when it expires stays unverified.
- **Severity:** Medium.
- **Workaround:** `pnpm ring:token` saves a freshly copied token from the clipboard into `.env` without printing it. `pnpm ring:smoke` records every response in one pass, and a mock Ring Playground (`packages/ring-partner-sdk/src/testing/mock-playground.ts`) serves those captured responses so the fixes could be finished and tested after the token expired.
- **Suggestion:** Offer a 24-hour developer token in the Playground, or a refresh token scoped to the sandbox device.

### 3. Ring API docs: filter event history by type

- **Status:** Partly evaluated on 22 October 2026. The first runs returned an empty page. A later live call returned 3 `on_demand` events, all created by our own Live View sessions on the Playground doorbell, so there were still no motion or ding events to filter out. Whether `event_types` filters server side remains unconfirmed; the "appears unfiltered" finding below comes from another entrant's forum report.
- **Payload shape differs from the docs:** the real events use `type: "history-events"` (hyphen), `attributes.start` and `attributes.end` as epoch milliseconds numbers (not ISO strings and not a `timestamp` field), `attributes.is_third_party_reviewed`, the device in `relationships.source`, an empty `relationships.cv_detections`, `meta.riid: null`, and no `links`. Our SDK schema rejected this page until we accepted that shape (fixture `packages/ring-partner-sdk/src/fixtures/playground/history-events.json`); consumers now convert epoch ms to ISO 8601.
- **Task attempted:** Retrieve only human motion events with `event_types`.
- **Steps taken:** Called `GET /v1/history/devices/{id}/events?event_types=motion.human,ding,on_demand` and the same path without the filter against the Playground; read the forum correction from Amazon staff about plural syntax.
- **Expected:** Only events of the requested types.
- **Actual:** Both calls initially returned 200 with `data: []`; a later unfiltered call returned the 3 `on_demand` events described above. Ring accepted the parameter (no 400), but an empty page cannot show whether it filters. A forum entrant reports that the response is unfiltered, and the documented parameter name and syntax did not match staff guidance until corrected in the forum.
- **Severity:** Medium. History filtering cannot be tested at all without events in the sandbox.
- **Workaround:** Client-side filtering in the SDK; documented in the README.
- **Suggestion:** Document the real event shape (epoch ms `start`/`end`, `history-events` type, `relationships.source`) with a sample response, fix the parameter documentation with a working example, and return a 400 with a helpful message when the filter syntax is wrong instead of silently ignoring it.

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

- **Status:** Corrected 22 October 2026. Our earlier entry said the encryption state was not exposed. That was wrong for end to end encryption: `GET /v1/devices/{id}/configurations` returns `e2e_encryption: { enabled: false }` for the sandbox doorbell. What remains undocumented is TAKE mode.
- **Task attempted:** Decide up front whether snapshots for a device will be readable.
- **Steps taken:** Called status, capabilities, and configurations for the Playground doorbell; read the encryption documentation added on 16 September 2026.
- **Expected:** A device attribute for encryption state that covers both E2EE and TAKE.
- **Actual:** E2EE is detectable from `configurations.e2e_encryption.enabled`. Nothing in status, capabilities, or configurations mentions TAKE, so an app still learns that a TAKE device's media is encrypted only when the bytes come back unreadable.
- **Severity:** Low (was Medium before the correction).
- **Workaround:** Device Check reads `e2e_encryption.enabled` for its encryption item. The Presence Engine marks a door whose encryption state is E2EE or TAKE unobservable with the reason "encrypted device", the snapshot service never stores a frame Ring flags as encrypted, and every feature stays event-only.
- **Suggestion:** Add TAKE to the same object (for example an `encryption.mode` of `none`, `take`, or `e2ee`), document it next to `e2e_encryption`, and send a webhook when it changes.

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

### 16. Ring API: parse real device payloads with strict schemas

- **Status:** Reproduced 22 October 2026 against the Playground doorbell; worked around in the SDK the same day.
- **Task attempted:** Validate device status, capabilities, configurations, and location with strict Zod schemas written from the Partner API documentation and the official `ring-api-helloworld` sample's schemas.
- **Steps taken:** Ran `pnpm ring:smoke` with a Playground token, then compared each raw response with the schema that rejected it.
- **Expected:** Payloads with the resource type names and field types the documentation shows.
- **Actual:** All four calls returned 200, and the SDK threw `RingSchemaError` on each. The real `type` values are `device-status`, `device-capabilities`, `device-configurations`, and `locations`, which neither the documentation nor the sample shows. Many fields are `null`: `state`, `audio.snooze.active`, `audio.snooze.until`, `audio.customizable_slots`, `audio.supported_actions`, `battery_status`, `flood_detection`, and the other sensor capabilities. In the console, Device Check showed "0 of 5 checks passing" with every item "Not Reported", while the real data said online, motion detection on, one motion zone, and end to end encryption off.
- **Severity:** High. Every device read failed on first contact, and a family would have been told their doorbell reported nothing.
- **Workaround:** Committed the captured bodies as fixtures with a manifest of request paths and status codes. The schemas now use the real type names, accept `null` wherever Ring returned it, and keep unknown keys, while still validating the fields VisitProof relies on (`online`, `reported_at`, `motion_detection.enabled`, motion zone vertices, `e2e_encryption.enabled`, `country`). On the captured data Device Check reads "4 of 4 required checks passing, plus 1 informational item".
- **Suggestion:** Publish a complete response example for every resource, with the real `type` value and with `null` shown wherever Ring can return it, and state which fields are nullable. A JSON schema or OpenAPI document for the Partner API would let partners generate validators instead of guessing.

### 17. Ring API: read subscriptions as the Playground user

- **Status:** Reproduced 22 October 2026.
- **Task attempted:** Read the account's Ring subscriptions with the SDK's `subscriptions()` call as part of the Playground smoke run.
- **Steps taken:** Called `GET /v1/accounts/me/subscriptions` with a Playground token.
- **Expected:** 200 with an empty list, or a documented error that says subscriptions are not available in the Playground.
- **Actual:** 422 Unprocessable Entity with "Unable to process subscription request for this user". A 422 usually means the request was malformed, which it was not.
- **Severity:** Low.
- **Workaround:** The SDK maps this 422 to a typed `RingNotAvailableForAccountError`, and `pnpm ring:smoke` reports it as INFO rather than FAIL.
- **Suggestion:** Return an empty list for the Playground user, or a documented error code meaning "not available for this account", and note it in the subscriptions reference.

### 18. Ring Playground: see video in live view from the sandbox doorbell

- **Status:** Reproduced 22 October 2026 in the embedded browser and in Google Chrome, then resolved the same day at about 08:35 EAT by triggering a Playground simulation. It stays in this log because the documentation does not say a simulation is needed.
- **Task attempted:** Show the sandbox doorbell's live view on `/family/live` over WHEP.
- **Steps taken:** Started a session through the console's `/api/ring/stream`, which posts the SDP offer to `POST /v1/devices/{id}/media/streaming/whep/sessions`, then watched the peer connection state and WebRTC stats.
- **Expected:** Sample video from the sandbox doorbell, or a clear note in the live view documentation that the sandbox streams only after a simulated event.
- **Actual:** The session was created (200 with an SDP answer). ICE reached connected and DTLS connected, and the answer negotiated H264 (payload 118), RTX, and Opus. In 13 seconds only about 2.4 KB arrived and no `inbound-rtp` stats appeared: the sandbox doorbell sent no media. The Playground release notes mention live view event simulation for Package, Vehicle, and Motion, so triggering one may be required, but nothing next to the live view documentation says so. In our first sessions we did not trigger one. In a later run (about 08:35 EAT) we started a Motion "Simulate live view event" in the Ring Developer Playground first, and `/family/live` then decoded real video over WHEP: 250 frames at 1280x720 (the sample stream is "Birds on Feeders" by Michael Black, CC BY 4.0). Sessions without a simulation got no media, so the sandbox streams only during a simulated event.
- **Severity:** High. A connected session with a black player looks exactly like a bug in our WebRTC code, and we spent the time ruling that out.
- **Workaround:** Live View now ends a session that reaches connected but decodes no frame within 8 seconds: it sends DELETE for the session and shows a warning titled "Connected To Ring, But No Video Arrived". While it waits, the session cap countdown runs as usual; once the session ends, the countdown stops and the warning replaces it.
- **Suggestion:** Make the sandbox doorbell stream sample video continuously, or state next to the live view and WHEP documentation that video flows only while a live view event simulation is running.

## Feature Requests

| Priority | Platform | Request | Why |
|---|---|---|---|
| High | Ring Playground | Signed test webhooks to a developer-supplied URL | Makes the event path testable without hardware |
| High | Ring Playground | A sandbox doorbell that streams sample video continuously, or a documented trigger for it | A connected live view with no media is indistinguishable from a client bug |
| High | Ring API | Response examples that show real type names and every field that can be `null` | Strict validators written from the docs reject every real device payload |
| High | Ring API | Official test vectors for webhook signatures and nonces | Prevents certification failures |
| Medium | Ring API | A JSON schema or OpenAPI document for the Partner API | Partners can generate validators instead of guessing |
| Medium | Ring API | TAKE mode next to `e2e_encryption` on the device resource | Lets apps degrade gracefully before requesting media |
| Medium | Ring Playground | Pre-seeded history events of each type on the sandbox doorbell | History parsing and `event_types` filtering cannot be tested on an empty page |
| Medium | Ring API | Server-side `event_types` filtering that works as documented | Reduces client-side paging |
| Medium | Ring Developer Console | Secret rotation | Standard OAuth hygiene |
| Medium | Alexa+ | Public conformance checker for MCP add-ons | Everyone is guessing today |
| Low | Ring API | Watermark geometry in media headers | Reliable cropping for vision |
