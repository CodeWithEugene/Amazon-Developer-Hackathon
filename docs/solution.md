# VisitProof: The Solution

> Proof of presence for home care, from the doorbell already at the door.
>
> This document is the complete product definition: what we build, for whom, why, how it works technically and operationally, every user journey, the UX principles, the business model, the compliance posture, the hackathon packaging, and the roadmap. The engineering specification (pages, components, APIs, data model, infrastructure, schedule) is in [build.md](./build.md). The evidence behind the decisions is in [research.md](./research.md) and the customer problem in [problem.md](./problem.md).

---

## 1. Summary

**VisitProof** is a Ring Appstore app and web console for home-care agencies and the families who employ them. It turns the events a Ring doorbell or camera already produces (a doorbell press, a person detected at the door, a person leaving) into an independent, timestamped, tamper-evident record of when a caregiver arrived at and left a client's home, matched against the agency's schedule and the caregiver's own Electronic Visit Verification (EVV) clock-in.

It does four things nobody else in the Ring ecosystem does today:

1. **Real-time exceptions for the scheduler.** Late arrival, no-show, early departure, and "unobservable" states are raised within the grace window, not the next morning, so a coordinator can backfill while it still matters.
2. **EVV reconciliation for the compliance lead.** Every caregiver clock-in is corroborated, contradicted, or marked unobservable by the door record, with reasons, before a claim is submitted and denied under 2026 hard edits.
3. **A calm transparency feed for the family.** One message a day: "Caregiver arrived 6:04 AM, left 8:02 AM," with an optional doorbell snapshot the family controls, and alerts only when something is wrong.
4. **A fair record for the caregiver.** Observations, self-reports, and agency resolutions live in three separate columns, signed and never merged. A caregiver whose phone died still has proof they were there.

It is built on the Ring Partner API (OAuth account linking, devices, event history, HMAC-signed webhooks, snapshots, WHEP live view), runs on AWS (Bedrock Nova 2 Lite, Rekognition, AgentCore, Strands, Lambda, DynamoDB, KMS, S3, SES, Cognito, Amplify Hosting), exposes a spec-exact MCP server (2025-11-25, Streamable HTTP) so Alexa+ and coding agents can ask "did the aide come today?", ships an open-source TypeScript Ring Partner SDK and emulator, and is delivered as a strictly shadcn/ui Next.js application.

**Hackathon packaging:** Primary track Ring. Mini challenges AWS Builder and Open Source. Optional secondary track Alexa+ (the MCP server plus simulator over the same backend).

---

## 2. Who It Is For (Personas and Jobs To Be Done)

### 2.1 Dana, care coordinator at a 60-client agency (primary buyer's daily user)

- **Job:** keep today's 140 visits happening; find out about problems early enough to fix them; stop phoning families to confirm arrivals.
- **Today:** watches the EVV portal for clock-ins; assumes silence is fine until a family calls; discovers no-shows 30 to 60 minutes late.
- **With VisitProof:** opens the Today board at 5:45 AM; sees each visit's live status; gets an exception card at 6:15 when Mrs. Okoro's 6:00 visit has no arrival; taps Backfill, texts the standby caregiver from the card, marks the exception resolved with a reason; the family's feed updates automatically.
- **Success metric:** minutes from scheduled start to knowing about a no-show (target under 15); number of family confirmation calls per week (target near zero).

### 2.2 Marcus, billing and compliance lead (economic buyer)

- **Job:** submit clean claims the first time; survive audits; reduce visit-maintenance work.
- **Today:** exports EVV exceptions weekly; chases caregivers for attestations; eats denials.
- **With VisitProof:** opens Reconciliation; sees every clock-in for the week with a corroboration status; filters to "Contradicted" and "Missing clock-in with door presence"; attaches the signed VisitProof evidence record to visit-maintenance entries; exports the alternate-EVV JSON and the PDF evidence pack for the auditor.
- **Success metric:** first-pass claim acceptance rate; hours of visit maintenance per week; denials reversed with evidence.

### 2.3 Priya, adult daughter, lives 800 miles away (consent holder, family plan buyer)

- **Job:** know her mother is being cared for without watching her mother.
- **Today:** calls the agency; asks her mother, who does not remember; worries.
- **With VisitProof:** links her mother's Ring doorbell from the Ring app in two minutes; chooses "share arrivals and departures with the agency" and "include a doorbell snapshot at arrival, delete after 7 days"; receives one message each evening; gets an alert only when a visit is late or missed; can export or delete everything in two taps.
- **Success metric:** one message a day; zero surveillance of her mother; alerts only on exceptions.

### 2.4 Luis, home care aide, five visits a day

- **Job:** get paid for every visit; not be accused when the app fails.
- **Today:** clock-in fails in a basement apartment; disputes take weeks.
- **With VisitProof:** opens the caregiver record link on his phone; sees "Door: arrived 9:58, left 12:03" next to "Clock-in: none"; adds a note ("phone had no signal"); the agency resolves with evidence; he is paid.
- **Success metric:** disputes resolved in days; notes attached to the same signed record as the observation.

### 2.5 Mrs. Okoro, care recipient (protected party)

- She is never the subject. VisitProof reads events about the door, never learns her routine, never identifies anyone, never records inside the home, and the family can withdraw consent at any time in Ring My Apps.

### 2.6 Secondary personas

- **Agency owner:** buys per enrolled client; sees reliability analytics per caregiver and per client; uses evidence packs in payer negotiations.
- **Private-pay families without an agency:** buy the family plan in the Ring Appstore for the feed and the export alone.
- **Judges:** need a five-minute path from repo to a running demo with no hardware; see Section 10.

---

## 3. Why This, Why Now, Why Us

- **Why now:** the Ring Developer Portal reached general availability on 31 March 2026 and the Ring Appstore lists elder care as a headline category; Medicaid EVV hard edits switched on across states in 2026; families own the sensor already.
- **Why Ring:** the only broadly deployed, consent-native, server-signed presence sensor at the client's door. Its read-only API is a feature: VisitProof cannot and does not control anything.
- **Why us:** VisitProof is built by Technetium Kenya, whose founder works in healthcare analytics (Applied Health Analytics) in exactly this domain. The product speaks the language of six data elements, aggregators, reason codes, and payer denials because we do.
- **Why it wins on the judges' criteria:** deep and visible use of the Ring API at runtime (Tech), three coherent role-based surfaces with designed empty and error states (Design), a quantifiable regulatory and financial need with a named buyer and a distribution channel (Impact), and an agency-first, EVV-aware, corroboration-not-surveillance framing that no other entry has (Idea).

---

## 4. Product Principles (Non-Negotiable)

1. **Corroboration, not surveillance.** VisitProof says "a person arrived at the door at 6:04." It never says who. It never watches the resident.
2. **Events first, pixels optional.** Every feature works with zero video access. Snapshots are a family-controlled enrichment with automatic expiry. TAKE-encrypted and E2EE devices degrade to "unobservable" states, never to broken screens.
3. **Three columns, never merged.** Observed (door), Reported (caregiver clock-in and notes), Resolved (agency decision). Each is signed; none overwrites another.
4. **Silence is signed.** When the device was offline, out of zone, or the integration was paused, the record says "unobservable" with the reason, so "we saw nothing" is never confused with "nothing happened."
5. **Deterministic decisions, narrated by AI.** Rules classify visits. Bedrock writes the plain-language narrative and Jev resolves bounded ambiguities (which of two candidate events is the arrival). No model decides a status alone.
6. **One message a day.** Families get a digest; exceptions interrupt. Ring's UX guide caps routine notifications at one per day; we adopt it as product philosophy.
7. **Honest boundaries.** Not an EVV system of record. Not identity verification. Not a medical device. Said on the landing page, in the app, and in the video.
8. **Consent is a feature.** The family sees exactly what is shared with whom, can pause or revoke in one tap, and can export or delete everything.
9. **Judge-testable in five minutes.** One command replays a two-week schedule with every scenario; no hardware, no credentials.

---

## 5. The Experience (Surfaces and Journeys)

VisitProof has five surfaces. All are one Next.js application with role-based routing, plus the MCP server.

| Surface | User | Entry | Purpose |
|---|---|---|---|
| Agency Console | Dana, Marcus, owner | `app.visitproof.com` (sign in) | Today board, exceptions, clients, caregivers, schedule, reconciliation, reports, exports, settings |
| Family Portal | Priya | Ring Appstore link, then `family.visitproof.com` | Link Ring, consent, daily feed, visit details, live view, privacy controls |
| Caregiver Record | Luis | Magic link from the agency | My visits, door record, notes, disputes |
| Ring Endpoints | Ring platform | Token Exchange URL, Account Link URL, App Homepage URL, Webhook URL | Certification-ready account linking and event ingestion |
| Ask VisitProof (MCP + Alexa+ simulator) | Priya by voice, Dana via ops copilot, agents | `/mcp` endpoint; `/ask` simulator | Voice-first questions and confirmations over the same data |

### 5.1 Journey A: The agency onboards (Dana and Marcus, 20 minutes)

1. Dana signs up with her work email (passwordless code). VisitProof creates the agency workspace and asks three questions: agency name, state (drives EVV notes), and default visit tolerances (grace 15 minutes, early-departure tolerance 10 minutes).
2. She adds clients: name, home label, expected devices, family contact email. Or imports a CSV from her scheduling system (columns documented; a sample is provided).
3. She adds caregivers: name, mobile, EVV employee ID.
4. She imports the schedule: CSV or ICS with client, caregiver, service code, start, end, authorized units. Recurring visits are supported.
5. For each client, she clicks **Invite Family To Link Ring**. The family receives an email with a plain-language explanation and the Ring Appstore link.
6. The Today board shows every client with a status chip: Ring Linked, Awaiting Family, or No Device.

Empty states guide each step ("No Clients Yet: import a CSV or add your first client").

### 5.2 Journey B: The family links Ring (Priya, 3 minutes)

1. Priya opens the invitation, reads what will be shared (arrival and departure times; optional snapshot at arrival; never continuous video), and taps **Open In Ring Appstore**.
2. In the Ring app she selects VisitProof, reviews the requested data access, chooses which devices to share (front door doorbell), and taps Confirm. Ring posts an authorization code to VisitProof's Token Exchange URL; VisitProof exchanges it within 60 seconds, calls `/v1/users/me`, and stores the unclaimed token.
3. Ring redirects her browser to VisitProof's Account Link page with a nonce. VisitProof checks freshness, pre-fills her Ring email, and offers **Create Account** (passwordless, one code). The nonce is matched to the unclaimed token in constant time; VisitProof confirms the integration (`POST app-integrations`) and completes it (`PATCH status completed`).
4. The App Homepage confirms "Account Linked Successfully," then opens **Consent Settings**: share with the agency (on), snapshot at arrival (off by default, toggle to on with a 7-day retention), evening digest time (7 PM), exception alerts (on).
5. Device Check runs: online status, motion recording enabled, a motion zone that covers the walkway. If anything is off, VisitProof explains what to change in the Ring app and why (it cannot change settings itself).
6. The agency's Today board flips the client to Ring Linked.

If the family has no Ring device, VisitProof offers the Unobserved Client mode: the agency still gets schedule and EVV reconciliation, marked unobservable.

### 5.3 Journey C: A normal day (all personas, zero effort)

- 5:58 AM: `motion_detected` with `sub_type: human` arrives at the Webhook URL, signature verified, deduplicated, stored. The Presence Engine finds an open visit window for Mrs. Okoro (6:00 to 8:00, Luis) and records an arrival candidate.
- 6:01 AM: `button_press`. The engine confirms arrival at 5:58 (first human event in the window), status **On Time**. If the family enabled snapshots, VisitProof requests an image at that timestamp 15 seconds later, crops the watermark band for label detection only, stores the original with the watermark intact, and attaches Rekognition labels ("Person", "Bag") as non-identifying context.
- 8:03 AM: last human motion. After the departure quiet period (no further human motion for 10 minutes) the engine records departure at 8:03, duration 2 hours 5 minutes, status **Completed**.
- 8:20 AM: Luis's EVV clock-in (imported from the agency's vendor CSV or entered via the caregiver link) shows 6:07 to 8:00 with GPS 400 m away. Reconciliation: **Corroborated** (arrival within 10 minutes of clock-in; departure within 10 minutes), GPS drift noted as informational.
- 7:00 PM: Priya's digest: "Today at Mom's: caregiver arrived 5:58 AM and left 8:03 AM (2 h 5 m). Everything looked normal." Generated by Bedrock Nova 2 Lite from the structured record, checked by Guardrails, with a deterministic template fallback.

### 5.4 Journey D: A late arrival becomes a backfill (Dana, 6:15 AM)

1. 6:15 AM: the grace window closes with no arrival. The Visit Sweeper raises an exception **Late: No Arrival Yet** and emails Dana; the Today board card turns to the warning state with a live timer.
2. Dana opens the exception: schedule details, door status (device online, last human event yesterday 8:03 PM), caregiver contact, and three actions: **Call Caregiver**, **Backfill**, **Snooze 10 Minutes**.
3. 6:22 AM: `button_press` arrives. Status becomes **Late Arrival (22 minutes)**; the exception auto-resolves to "Arrived late," and Dana adds the reason "Traffic."
4. If no arrival by 6:45 (escalation window), the exception becomes **No Show**; Backfill opens the standby list; when the standby caregiver's arrival is observed, the visit is re-assigned and the family feed reads "A replacement caregiver arrived at 7:10 AM."

### 5.5 Journey E: Reconciling the week (Marcus, Friday)

1. Marcus imports the EVV export (CSV in the documented shape; a Sandata-style sample ships with the app).
2. The Reconciliation table shows every visit with door status and clock-in status and a corroboration outcome: Corroborated, Contradicted, Missing Clock-In With Door Presence, Missing Both, Unobservable.
3. He filters to Contradicted and Missing Clock-In, opens each, reads the evidence timeline, and either marks it **Ready For Visit Maintenance** (with reason code) or **Needs Caregiver Note** (sends Luis a request).
4. He exports **Evidence Pack (PDF)** and **Alternate EVV JSON** for the week; both are signed with the agency's KMS key and verifiable offline with the included `verify` tool.

### 5.6 Journey F: A caregiver disputes (Luis, Saturday)

1. Luis opens his caregiver link; the visit shows Door: 9:58 to 12:03; Clock-in: none; Status: Missing Clock-In With Door Presence.
2. He adds a note; Jev classifies it as an explanation (not a dispute) and the note is stored in the Reported column, signed.
3. Marcus resolves: "Corroborated by door record; manual visit added with reason code." Resolved column signed. Luis sees the resolution.

### 5.7 Journey G: Asking by voice (Priya, Echo Show or the simulator)

- "Did the caregiver come to Mom's today?" The MCP tool `get_visit_status` returns structured content plus a spoken line: "Yes. Someone arrived at 5:58 this morning and left at 8:03. Luis clocked in at 6:07."
- "Was anyone late this week?" `list_exceptions` returns at most five items with a spoken summary.
- "Tell the agency I'll be there Thursday instead." `add_visit_note` asks for confirmation (elicitation when the client supports it; a `confirmed` argument otherwise) and writes a signed note.
- For Dana, the ops copilot (Strands agent over the same tools) answers "Which clients have unlinked Ring devices?" and "Draft the family message for the Okoro exception."

### 5.8 Journey H: Withdrawal and deletion (Priya)

- In Ring My Apps she removes VisitProof; Ring sends `app_integration_removed`; VisitProof revokes tokens, stops ingestion, marks the client Unlinked, archives then deletes door events on the retention schedule, and emails a confirmation. In the Family Portal, **Delete Everything** does the same and removes the family account.

---

## 6. How It Works (Technical Design in Plain Terms)

### 6.1 Architecture at a glance

```
Ring Partner API (api.amazonvision.com)            Ring Playground (sandbox device)
  OAuth tokens  devices  history  media  webhooks     30-min tokens, WHEP live view
        |                     |                                 |
        v                     v                                 v
  [Webhook Receiver: Lambda + API Gateway]   [Ring SDK: typed client, WHEP helper, snapshot 303 helper]
        | verify HMAC, dedupe, persist, 202
        v
  [Event Bus: DynamoDB Streams / EventBridge]
        v
  [Presence Engine: Lambda]  <-- Visit Sweeper (EventBridge every minute)
        | match, classify, reconcile, sign
        v
  [DynamoDB single table]  [S3 snapshots, lifecycle]  [KMS keys]  [SES email]
        ^                          ^
        |                          |
  [Next.js 16 Console + Family Portal + Caregiver Record on Amplify Hosting]
        |
  [MCP Server on AgentCore Runtime (Cognito JWT)]  <--  Alexa+ simulator, Strands ops copilot, Claude, Kiro
        |
  [Bedrock Nova 2 Lite + Guardrails: narratives]  [Rekognition: labels]  [Jev: bounded judgments]

  [Emulator: signed Ring webhooks + mock /v1 endpoints for judge demos]
```

### 6.2 The Presence Engine (deterministic core)

Inputs: normalized door events per client (type, sub_type, timestamp, device, provenance), the schedule (visits with windows and tolerances), device state (online, motion recording, integration status, encryption state), and EVV records.

Rules, in order:

1. **Window:** a visit is observable from `start − 60 min` to `end + 60 min`.
2. **Arrival:** the first `button_press` or `motion_detected(sub_type=human)` in `[start − 30 min, start + grace]` is the arrival candidate. If several candidates fall within 5 minutes, the earliest wins. If two clusters exist more than 20 minutes apart before `start + grace`, the case is ambiguous and Jev chooses the caregiver arrival among candidates using timing, labels, and whether a delivery-like pattern (short dwell, vehicle motion) explains the other cluster.
3. **Departure:** the last human event after arrival followed by a quiet period of 10 minutes; if events continue past `end + 60 min`, departure is "not observed."
4. **Status:** On Time; Late (arrival after `start + grace`); No Show (no arrival by `start + escalation`, default 45 minutes); Early Departure (departure before `end − tolerance`); Completed; Unobservable (device offline for any part of the window, integration paused, encrypted device, motion recording off, no motion zone) with the specific reason; Ambiguous (Jev confidence below threshold), routed to a human.
5. **Reconciliation:** compare arrival and departure with the EVV clock-in and clock-out: Corroborated (both within 10 minutes), Contradicted (clock-in exists but no door presence in the window, or times differ by more than 30 minutes), Missing Clock-In With Door Presence, Missing Both, Unobservable.
6. **Signing:** every observation, report, and resolution is hashed with the previous record (per client chain) and signed with the agency's KMS asymmetric key; evidence packs include the chain and a stdlib verifier.

Everything above is unit-tested with recorded fixtures for every scenario in the emulator.

### 6.3 Where AI is used and where it is not

| Use | Model | Why it is safe |
|---|---|---|
| Family digest and exception narrative | Bedrock Nova 2 Lite via Converse, Guardrails on | Input is the structured record; output is validated against rules (must include times, must not speculate, must not mention health); deterministic template fallback with provenance label |
| Snapshot context labels | Rekognition DetectLabels on the watermark-cropped frame | Labels only (person, bag, vehicle); no faces; results stored as context, never as identity |
| Ambiguous arrival choice; caregiver note classification (dispute, explanation, FYI); exception reason suggestion | TypeSafe Jev (Choice and Noul questions) | Typed answers with probabilities; thresholds route low-confidence cases to a human; state is the candidate set, not free text |
| Ops copilot for the scheduler and the Alexa+ brain | Strands agent (Nova 2 Lite) over VisitProof's own MCP tools | The agent can only call read tools and confirmation-gated write tools; no direct data access |

No model ever sets a visit status alone.

### 6.4 Ring API usage (what judges will see at runtime)

- OAuth one-way account linking end to end (Token Exchange URL, nonce verification, `POST` and `PATCH app-integrations`), plus Playground token mode for development.
- `GET /v1/users/me`, `GET /v1/devices?include=status,capabilities,location,configurations`, `GET /v1/history/devices/{id}/events` (backfill since consent, paced under the rate limit, client-side type filtering).
- Webhooks: `motion_detected`, `button_press`, `device_online/offline`, `device_added/removed`, `app_integration_added/removed`, `subscription_activated/deactivated`, Early Access contact sensor events (emulated, labeled).
- `POST /v1/devices/{id}/media/image/download` with `at_timestamp` and `latest_in_range`, following the 303, handling 416/425/403.
- WHEP live view in the Family Portal (time-boxed, countdown, explicit DELETE) against the Playground sandbox device.
- Chime audio playback is deliberately not used in v1 (noise in a client's home is not appropriate for this product); it is listed as a roadmap option for "caregiver reminder" with family opt-in.

### 6.5 Data, privacy, and retention

- Door events: retained 90 days by default (agency configurable 30 to 365), then deleted; evidence records retained 7 years for compliance as signed summaries without media.
- Snapshots: off by default; when on, stored in S3 with a 7-day lifecycle (family configurable 1 to 30 days), watermark intact, encrypted at rest, never shared with caregivers, shared with the agency only when the family opts in.
- Tokens: KMS envelope encryption; never in the browser.
- No cross-account correlation, no facial recognition, no training on Ring data; certification questionnaire answers are drafted in `docs/compliance.md`.
- Deletion: family and agency both have one-click paths; Ring unlink triggers the same pipeline.

### 6.6 Reliability and operations

- Webhook receiver returns 202 in under 100 ms; processing is asynchronous; idempotent on `meta.request_id`; unverified signatures rejected with 401 and logged.
- Visit Sweeper runs every minute; every rule is pure and time-injected for tests.
- Health endpoints, structured logs, CloudWatch alarms on webhook 5xx and sweeper failures; AgentCore Observability traces for the agent.
- Cost: under $40 for the hackathon; per-agency run cost is cents per client per month.

---

## 7. Design and UX Principles (How It Looks and Feels)

- **Strictly shadcn/ui** (Base UI primitives, Nova style, neutral base color, lucide icons, light and dark). The console is the `sidebar-07` app shell with `dashboard-01` patterns; the Family Portal is a mobile-first single column; the Caregiver Record is a single-page list.
- **Status language:** four visual states only, expressed with Badge variants and icons, never color alone: On Time and Completed (default), Late and Early Departure (warning), No Show and Contradicted (destructive), Unobservable and Awaiting (secondary). Every status has a one-line explanation on hover and in detail.
- **Calm by default:** families see one card per day; agencies see exceptions first, everything else second.
- **Empty and error states are designed, not defaulted:** every list has an `Empty` composition with the next action; every failure has a plain-language explanation and a retry.
- **Accessibility:** WCAG 2.2 AA (Ring's stated bar): keyboard reachable, labeled, contrast-safe tokens, reduced-motion respected, focus rings visible, screen-reader text for status icons.
- **Copy rules:** Title Case for titles and buttons; sentence case for body; no dashes; Ring terminology exactly as the UX guide requires ("Ring app", "Ring Appstore", "Ring My Apps", "Compatible with Ring cameras").
- **Provenance everywhere:** every event and image shows its source: "Ring webhook", "Ring Playground sandbox device", "Emulated event (demo)". Judges and customers should never wonder whether something is real.

---

## 8. Business Model and Go To Market

- **Agency plan (primary):** $4 per enrolled client per month, billed to the agency, annual discount; includes unlimited staff seats, reconciliation, exports, analytics, MCP access. A 60-client agency pays about $240 per month against denied claims worth $80 to $150 each.
- **Family plan (Ring Appstore):** $4.99 per device per month (Ring keeps 10%); feed, alerts, live view, evidence export; upgrades to agency sharing when the agency adopts VisitProof.
- **Distribution:** Ring Appstore elder-care category (US, state-by-state rollout after certification; private app first for pilots); direct sales to agencies through home-care associations and state EVV forums; integrations with agency platforms (AxisCare, WellSky, AlayaCare, HHAeXchange) via the alternate-EVV export and, later, their APIs.
- **Land and expand:** a family plan user asks their agency; an agency pilot with 10 clients expands to all Medicaid clients once the first denial is reversed with a VisitProof evidence pack.
- **Path to Ring certification:** private app for pilots (10 accounts), then public app certification (questionnaire drafted), gradual rollout 10/30/70/100.
- **Moat:** the three-column signed record with EVV semantics, the reconciliation logic, and the agency relationships; not the doorbell.

---

## 9. Compliance and Ethics Posture (Said Out Loud)

- Not an EVV system of record; corroborates and exports. The agency's EVV vendor and the state aggregator remain authoritative.
- No identity inference: no facial recognition, no gait, no voice. The record says "a person," never "Luis," unless Luis's own clock-in or note says so.
- No resident monitoring: no routine learning, no inactivity alerts, no interior cameras. Door events only.
- No cross-account networks: each family's data is isolated; agencies see only clients whose families linked and opted in.
- Consent is granular, visible, and revocable; deletion is real and cascades to backups on schedule.
- HIPAA-aware design: visit metadata may be PHI when joined to service codes; encrypted at rest and in transit, access-logged, minimum necessary; a BAA is offered to agencies in production.
- Ring Appstore policies honored: terminology, notification caps, WCAG 2.2 AA, privacy zones respected, TAKE and E2EE handled gracefully, no "Ring" or "Amazon" in the name.

---

## 10. Hackathon Packaging (How Judges Experience It)

- **Judge Quick Start (three commands):** `pnpm install`, `pnpm demo`, open `http://localhost:3000`. The demo replays two weeks of emulated, signed Ring webhooks for three clients (Okoro, Nakamura, Alvarez) covering every scenario, seeds EVV records, and logs in as Dana, Marcus, Priya, and Luis with one click each. No AWS or Ring credentials needed (fixtures label themselves "Demo").
- **Live mode:** with a Ring Playground token, Device Check, history backfill, snapshot requests, and WHEP live view run against the real API; the video shows both.
- **Video (under 3 minutes):** 0:00 the 6 AM scheduler and the denied claim; 0:20 the doorbell as the instrument; 0:40 Priya links Ring (real Ring Appstore flow on the Playground plus emulator); 1:00 a normal day and the digest; 1:20 the late arrival and backfill; 1:50 reconciliation and the signed export; 2:15 "Alexa, did the caregiver come?"; 2:30 architecture card naming Ring APIs and AWS services; 2:45 boundaries and what's next.
- **Devpost description:** criteria map table, testing instructions, product feedback, friction log summary, AWS integrations table, Open Source contribution (repo plus the `@visitproof/ring-partner-sdk` npm package).
- **Tracks:** Ring (primary), AWS Builder, Open Source, and Alexa+ (secondary) if the simulator is polished by day 20.

---

## 11. Scope: What Ships, What Waits

### 11.1 Ships for the hackathon (v0.1)

Agency Console (Today, Exceptions, Clients, Caregivers, Schedule import, Reconciliation, Reports with two charts, Exports, Settings, Ring Connections); Family Portal (link flow, consent, feed, visit detail, live view, privacy); Caregiver Record (list, notes); Ring endpoints (certification-ready); Presence Engine with all statuses; EVV CSV import and reconciliation; signed evidence records and PDF plus alternate-EVV JSON exports with offline verifier; email notifications and digests; MCP server with seven tools, one resource template, one prompt; Alexa+ simulator; Strands ops copilot; emulator with eight scenarios; SDK package on npm; tests and CI; docs; friction log.

### 11.2 Cut list (explicitly deferred)

Live vendor APIs for EVV (Sandata, HHAeXchange); SMS; chime reminders; contact-sensor production support (Early Access); Echo Show or Fire TV family view; multi-agency marketplaces; billing integration (Stripe Connect via Ring); mobile apps; multi-language.

### 11.3 Roadmap after the hackathon

Q4 2026: private-app pilots with two agencies; Ring certification submission. Q1 2027: alternate-EVV vendor onboarding in two Provider Choice states; agency platform integrations; family Echo Show view via MCP Apps. Q2 2027: sensors when GA; caregiver mobile app; payer evidence API.

---

## 12. Success Metrics (How We Know It Works)

| Metric | Target for the demo dataset | Target in production |
|---|---|---|
| Time from scheduled start to no-show alert | 15 minutes | under 15 minutes |
| Exception precision on the emulated two weeks | 100% (deterministic) | over 95% with real devices |
| Corroboration coverage of EVV exceptions | 100% classified | over 90% |
| Family digest cadence | 1 per day | 1 per day, 0 false alarms per month per client |
| Judge quick start time | under 5 minutes | not applicable |
| MCP conformance checks | all pass | all pass |
| Test coverage of `packages/domain` | over 80% | over 80% |

---

## 13. One Paragraph for the Devpost Tagline Field

VisitProof turns the Ring doorbell already at a home-care client's door into proof of presence: real-time late and no-show alerts for the agency scheduler, EVV reconciliation and signed evidence exports for the compliance lead, one calm message a day for the family, and a fair record for the caregiver. Built on the Ring Partner API and AWS, agent-ready through a spec-exact MCP server, open source.
