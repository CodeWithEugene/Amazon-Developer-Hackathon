# Research: Build, Ship, Shape 2026 (Everything We Found, Why It Matters, and What We Decided)

> Research window: 27 September 2026. Method: primary sources first (Devpost rules, Amazon developer documentation, Amazon newsroom, Amazon Developer Community forum, dev.to Amazon Dev News), then the public GitHub repositories of other 2026 entrants, then press and market data, then a structured decision pass using TypeSafe's Jev model. Every section ends with the implication for our entry. Sources are collected in Section 14. The hackathon facts themselves live in [info.md](./info.md); this document is about everything around them.

---

## 0. The One-Page Conclusion

- **Track:** Ring. **Concept:** VisitProof, proof of presence for home-care visits, built for home-care agencies and the families who employ them. **Mini challenges:** AWS Builder and Open Source. **Secondary surface:** a spec-exact MCP server (2025-11-25, Streamable HTTP) over the same backend so Alexa+ and coding agents can ask "did the aide come today?", which also lets us optionally enter the Alexa+ track as a secondary without diluting the primary.
- **Why Ring:** it is the least crowded track that needs no hardware for a non-US builder (the Playground and emulator path is officially accepted), it is web-first (Amazon's own reference app is Next.js), the priority categories name caretaking and business systems explicitly, and no judge on the panel is a Ring product specialist, so clarity of the API usage in the video and README carries unusual weight.
- **Why this concept:** the Ring caretaking lane is already full of family-facing "did grandma move today" apps (StillThere, Nightlight, Ring Med Watch, Beside Care, Density Routines) and of household-facing visit records (Attest, CareDoor). Nobody is building for the agency, and the agency has the most urgent, quantifiable, regulatory pain in 2026: Medicaid EVV "hard edits" now deny claims that lack a verified visit, GPS clock-ins are unreliable, and families cannot tell whether the caregiver arrived on time or stayed the full shift. Our founder's healthcare-analytics background makes that case credible in a way other entrants cannot copy.
- **Jev decision run:** across 12 candidate concepts spanning all four tracks, the agency proof-of-presence concept scored highest on every judge criterion composite (0.45 vs 0.32 for the runner-up) and was selected with 0.99 confidence; the Ring track was selected with 0.97 probability. Details in Section 10.

---

## 1. What the Hackathon Really Rewards (Read Between the Lines)

The four criteria are equally weighted, but the mechanics tilt the field:

| Mechanic | Consequence for us |
|---|---|
| Stage One is pass/fail on "reasonably applies the required APIs" and the runtime rule ("imported and actually called, not just named in the README") | A clearly named module that calls the Ring Partner API (OAuth, devices, history, media, webhooks with HMAC verification) must be obvious in the repo tree and shown in the video. |
| Tie-break is Tech Implementation first | Tests, CI, verified webhook signatures, idempotency, real WHEP frames, and correct 303/416/425 handling matter more than one extra feature. |
| Judges see a Devpost page with title, tagline, video, description, images, "Built With"; they rate 1 to 5 stars per criterion; roughly 3 to 6 minutes per entry with ~1,000 entries | The first 20 seconds of the video and the first paragraph of the description decide most of the score. |
| Friction logs earn up to 10% (scored by Amazon's internal teams at Stage One) | Keep a structured friction log from day one; the Ring Playground and the Alexa+ tooling gaps are rich, legitimate material. |
| Potential Impact cites the Ring Appstore and Fire TV Appstore | Show the path to the Ring Appstore: private-app first, certification questionnaire answers, subscription model, and Ring's own elder-care category. |
| Quality of the Idea says judges distinguish "obvious versus innovative" per track | Anything that is "run a vision model and alert" is obvious in Ring's ecosystem (almost every launch app does it). An agency-grade operations and compliance product that runs on event metadata is not. |
| One project can be entered in multiple primary tracks and judged in each, but can win only one track prize plus one mini | A thin, honest Alexa+ secondary entry over the same backend raises the chance of any prize without splitting the build. |
| Judging runs to 20 November | Hosted demo, seeded data, and credentials must survive four weeks after the deadline. |

Amazon's own creative examples in the rules text: for Ring, "non-security use case (accessibility aid, care-taking monitoring), business system integration"; for AWS Builder, "multi-service pipeline (Bedrock + AgentCore + Strands), agentic architecture with Claude/Kiro"; for Open Source, "meaningful feature addition with tests, bug fix that unblocks other developers." VisitProof is literally "care-taking monitoring plus business system integration."

---

## 2. Ring Platform Research (The Track We Chose)

### 2.1 What the platform is, in one paragraph

Ring opened its cameras to third parties in 2026. Developers register in the Amazon Developer Console (Ring section), verify identity with a government photo ID, create an app (Public or Private), receive a Client ID, Client Secret, and HMAC Signing Key (shown once, cannot be regenerated), and configure four HTTPS endpoints per environment: Account Link URL, Token Exchange URL, Webhook URL, App Homepage URL. The app is a backend that talks to `https://api.amazonvision.com` (JSON:API, 100 requests per second per client_id) with OAuth bearer tokens (access ~4 hours, refresh ~30 days, rotating), receives HMAC-SHA256-signed webhooks (must answer 2xx within 5 seconds; 7 retries with backoff; 72-hour dead-letter queue), and is distributed through the Ring Appstore inside the Ring app (US-only, subscribers only, monthly per-device subscriptions, 10% Ring fee, free to publish). Browser calls are blocked by CORS, so every product needs a server.

### 2.2 What you can and cannot do (this defines the product boundary)

**Can (read):** list devices shared with the app (cameras, doorbells, Early Access sensors and chimes) with `?include=status,capabilities,location,configurations`; device online state; capabilities (codecs, motion detection, image enhancements, multi-camera components); coarse location (country, US state); configurations (motion zones, privacy zones as normalized polygons, image settings); event history for cameras and doorbells (`motion.human`, `motion.vehicle`, `motion.animal`, `motion.other_motion`, `ding`, `on_demand`, newest first, cursor paginated, time-gated to after consent); subscriptions for the user in your app.

**Can (real time):** webhooks `motion_detected` (with `sub_type` human/vehicle/other_motion and `component_ids` on Ring Elite), `button_press`, `device_added/removed`, `device_online/offline`, `app_integration_added/removed`, `subscription_activated/deactivated`, and Early Access sensor events (`contact_sensor_faulted/cleared`, `tamper_*`, `flood_*`, `freeze_*`, `temperature_*`, `humidity_*`, `pm25_*`, `co_*`). Payload v1.1 example:

```json
{
  "meta": {"version": "1.1", "time": "2026-02-13T13:39:57.200Z", "request_id": "2ad45ade-...", "account_id": "ava1.ring.account.XXX"},
  "data": {
    "id": "<device_id>_motion_<timestamp>",
    "type": "motion_detected",
    "attributes": {"source": "<device_id>", "source_type": "devices", "timestamp": 1786715596787, "timestamp_readable": "2026-08-14 08:53:16", "sub_type": "human", "component_ids": ["0"]},
    "relationships": {"devices": {"links": {"self": "/v1/devices/<device_id>"}}}
  }
}
```

Signature: `X-Signature: sha256=<hex HMAC-SHA256 over the raw body bytes>`. Dedupe on `meta.request_id`.

**Can (media):** live video via WHEP (browser WebRTC, `recvonly`, session capped at 30 s battery / 60 s wired, not reaped automatically, starting a session triggers a recording and an `on_demand` history event) or RTSPS (server side); MP4 clip download up to 15 minutes from recordings (`206` with `X-Media-Length` for partials, `416` when nothing recorded); JPEG/PNG snapshot from an existing recording or stored still (`303` redirect to a presigned URL, `X-Media-Origin: recording|snapshot`, `416 MEDIA_NOT_FOUND`, `425 RECORDING_NOT_READY`, `403 TIME_RANGE_NOT_AUTHORIZED` before consent time, 180-day window, 24-hour `latest_in_range` cap). Every frame carries a mandatory server-side watermark (Ring logo, device ID, app name, timestamp) in the top band.

**Can (write):** exactly one thing: play a pre-assigned audio slot on a Ring Chime (`POST /v1/devices/{id}/media/audio/playback`, Chime Controls capability, two slots).

**Cannot:** control devices (no arming, settings, locks, siren, two-way talk), capture a live snapshot on demand, receive bounding boxes or thumbnails in webhooks, identify people (facial recognition is prohibited for non-enrolled people and effectively disallowed at launch; Familiar Faces is a Ring-app feature not exposed to partners), see E2EE devices at all, or read media from TAKE-encrypted devices (TAKE, "Throw Away the Key Encryption", is rolling out as the default for all customers from September 2026; media calls succeed but return encrypted bytes until Ring ships partner support). Implication: **design for event metadata first and treat pixels as optional enrichment.** VisitProof works fully with zero video access and gets better when a snapshot is available.

### 2.3 Auth and account linking (exact, because judges of "Tech Implementation" will look)

One-way (Ring-driven) linking, the recommended production flow:

1. Customer installs the app from the Ring Appstore, reviews requested data, selects devices, taps Confirm.
2. Ring POSTs an authorization code to the Token Exchange URL; exchange it within **60 seconds** at `https://oauth.ring.com/oauth/token` (`grant_type=authorization_code`, `client_id`, `client_secret`) for `{access_token, refresh_token, scope, expires_in: 14400}`.
3. Call `GET /v1/users/me` and store the account id (`ava1.ring.account.X`) with the tokens as UNCLAIMED.
4. Ring sends `device_added` per shared device (integration PENDING).
5. Ring redirects the customer's browser to the Account Link URL with `?nonce=<urlsafe-b64>&time=<epoch_ms>`. Reject if older than 600 s or in the future.
6. Show sign-in or create-account (mandatory; the UX guide strongly recommends passwordless linking using the Ring email from `/v1/users/me`).
7. Match the nonce: `base64url_nopad(HMAC_SHA256(hmac_key, "{time}:{account_id}"))` against every UNCLAIMED token in constant time.
8. `POST /v1/accounts/me/app-integrations {"account_identifier": "...", "nonce": "..."}` (status `awaiting`), then **`PATCH ... {"status": "completed"}`** (forgetting this leaves the integration "Inactive" in the Ring app).
9. Ring sends `app_integration_added` and forwards the customer to the App Homepage URL, which must confirm success and route onward.

Partner-initiated OAuth 2.0 with PKCE exists (invitation-only, free apps only). Playground tokens (30 minutes, no refresh) are the third path and the one we use for development.

### 2.4 Testing without hardware (the exact situation for a non-US builder)

- **Ring Developer Playground** (released 28 May 2026): sign in, mint a 30-minute token, use the interactive API explorer, and list/inspect/live-stream a **shared sandbox doorbell**. Community evidence in the Devpost forum (answered by judge Emerson Sklar) and public repos: the sandbox device logs only `on_demand` events, so there are no motion or doorbell events to drive the webhook path, Playground sessions cannot deliver webhooks to localhost, `event_types` filtering appears to be ignored server-side (filter client-side), and historical image download returned 416 when no stored images existed. Emerson also corrected the docs: motion classification arrives in `attributes.sub_type`, filter syntax is plural (`event_types=motion.human,motion.vehicle`), and WHEP supports optional audio. He confirmed the Playground is the accepted path for non-US entrants.
- **Community emulator `ring-sandbox`** (MIT, PyPI, built during this hackathon by the Attest author): FastAPI service that reproduces the JSON:API shapes, signed v1.1 webhooks, the snapshot 303 flow, clip 206/416 semantics, sensors, chimes, WHEP signaling, a `/_sandbox` control plane to inject events, chaos profiles, and scenarios including `home_aide_visit`, `short_visit`, `no_show`, `delivery`, `device_flap`. OAuth/nonce and RTSP are not emulated.
- **Official sample `ring-api-helloworld`** (Next.js 14, Tailwind, WebRTC/WHEP, SSE, MediaPipe hands, video-processor plugin system): shows the browser WHEP pattern (browser does WebRTC, server does the WHEP HTTP call), but its webhook route does not verify HMAC and its Zod schema is the older 1.0 payload shape. Judge Giovanni Laquidara authored it; a minimally modified copy would be recognized instantly.
- **Staging with a real device** needs a US-located device, a paid Ring plan, 2FA, motion recording on, the two-step allowlist, and a support-provisioned per-app trial, with multi-day turnarounds. Not viable for us in 26 days.

Implication: our demo path is Playground (real API calls: devices, capabilities, configurations, history, WHEP live frames) plus our own TypeScript emulator that sends HMAC-signed v1.1 webhooks for a replayable multi-client schedule, with provenance labels everywhere ("Playground sandbox device", "Emulated event"). Judges reward this honesty (Doorstep and Attest both do it).

### 2.5 UX design guide and content policy (constraints we must honor)

- Terminology: "Ring app", "Partner app", "Ring Appstore", "Ring My Apps"; "Compatible with Ring cameras"; never "Powered by Ring", never Ring or Amazon in our name, domain, or logo.
- Registration-first sign-up, passwordless linking preferred, never block linking on email verification; App Homepage must not be a dead end.
- Show user-assigned device names, never raw IDs; online/offline with icon plus text; tell users which settings can only be changed in the Ring app (motion zones, privacy zones, recording).
- Subscription states to render (paid, trial, expired, cancelled); at most one routine email/SMS per day; granular opt-outs.
- WCAG 2.2 AA is the stated accessibility bar.
- Content policy: no cross-account surveillance networks, no vigilante features, no child-directed apps, data minimization, consent that can be withdrawn, easy permanent deletion, no selling Ring data, biometrics only for enrolled people with opt-in (we use none), public-safety features need per-instance consent (we have none).
- Program requirements: delete all end-user data when service stops; 45 days' notice before material changes; disclose any AI training on Ring data (we do none); alarm-service integrations need licenses (we have none).
- Certification: five-tab privacy and security questionnaire (General, Data Processing, AI Governance, Data Protection, Third Parties), reviewer notes for account creation, linking, and end-to-end testing; 90% reviewed within 48 hours. Publishing: gradual (10/30/70/100), beta (10 users), or full; US nationwide or by state. Private apps (up to 10 accounts) skip certification.

### 2.6 Ring Appstore launch roster (who is already there)

Density Routines (elder care: falls, routine changes), Beside Care (activity digests and safety alerts for caregiving), QueueFlow (queue analytics from metadata), StoreTraffic, ProxView (loitering), Lumeo (people counting), Visionify (workplace safety), memories.ai (fire/smoke/falls/leaks), Minut (short-term rentals), Package Protect, PoolScout, Maytronics, Meld (dogs), LawnWatch, WhatsThatBird.AI, Cheer Chime (Toast POS tips to a chime). Pattern: almost all are "run a vision model on Ring video and alert." Elder care is represented only by monitor-the-elder apps. Nobody serves the care agency, nobody reconciles against a schedule, nobody exports evidence for a payer.

### 2.7 Ring facts that shape our architecture

| Fact | Design response |
|---|---|
| 5-second webhook budget, 7 retries, at-least-once delivery | Accept, verify HMAC, persist raw body, return 202 immediately; process asynchronously; dedupe on `meta.request_id`. |
| Tokens rotate on every refresh; losing refresh tokens forces re-link | Durable token store, single-flight refresh, proactive refresh before 4 hours. |
| No live snapshot; snapshots come from recordings a few seconds after an event | Snapshot fetch runs 5 to 20 seconds after a doorbell or human-motion event using `at_timestamp` or `latest_in_range` with the event timestamp as lower bound. |
| WHEP sessions cap at 30/60 s and are not reaped | Live view is a deliberate, time-boxed action with a countdown and explicit DELETE. |
| Watermark band on all media | Crop the top band before any vision inference; always display Ring-original frames with the watermark intact. |
| TAKE encryption default; E2EE devices invisible | Every feature must work on events only; media is an enrichment with a graceful "encrypted device" state. |
| Motion events only inside configured motion zones | Onboarding checklist tells the family exactly which Ring-app settings to enable (motion recording on, zone covering the walkway). |
| Sensors and chimes are Early Access (cannot publish until GA) | Contact-sensor support is modeled and emulated but labeled Early Access; chime "caregiver reminder" is an optional stretch. |
| Coarse location returns only country and state | Location is a compliance attribute (US state for EVV rules), not a map pin. |
| Rate limit 100 TPS per client_id across all customers | History backfill is paced and cursor-based; polling is a fallback to webhooks, not the primary path. |

---

## 3. Alexa+ Research (Why It Is the Secondary Surface, Not the Primary Track)

### 3.1 How Alexa+ actually integrates third parties

Alexa+ (generative-AI Alexa, 12 countries as of September 2026, free on US Fire TVs since August 2026) routes customer intent through a reasoning layer to "experts" and third-party add-ons. Since July 2026 ("Alexa+ for Builders") there are three add-on paths: the Category SDK (predefined interfaces for restaurants, food, home services, booking, ticketing, rides), the **MCP Toolkit** (bring your own MCP server; Alexa+ inspects it, registers tools in an Add-on Registry, routes requests over Streamable HTTP), and the Smart Home AI Toolkit. Partners named publicly: Canva, Priceline, Lyft, Headspace, Viator, Virgin Atlantic, Cengage, Fandango, TaskRabbit. In-conversation payments (Amazon Wallet, Partner Wallet) exist. All of this tooling (`@alexa-ai/cli` in a private registry, the local inspector, the web simulator) is available to select partners only and US-only. The hackathon FAQ confirms participants cannot access it.

Hard requirements from the MCP Toolkit docs, useful for anyone exposing an MCP server: Streamable HTTP, spec 2025-11-25 (though the documented Alexa+ client still initializes with `protocolVersion: "2025-03-26"` and declares only `roots`, no elicitation or sampling), public HTTPS, round trip under 500 ms, return 401 for unauthenticated requests, OAuth 2.1 authorization code with PKCE S256, `resource` parameter, static client registration (no dynamic client registration), register all Alexa redirect URIs, RFC 9728 protected-resource metadata, refresh tokens mandatory. Tool signatures lock after publication. Design guidance: one intent per tool, "declare only what you honor" in schemas, always return data (never empty), return only your own content in `structuredContent`, personalize via account linking, and render MCP Apps views when `_meta.ui.resourceUri` is present. The four UI patterns are List, Carousel, Card, Map; display modes are inline, fullscreen, voice-only, and hydrated.

### 3.2 What the Alexa+ track competition looks like

Estimated 42% of all entries (~440), many formulaic MCP servers, several bot-generated. Public eldercare entries already exist: CareCompanion (medication guardrails, daily check-ins, family dashboard MCP App), Refill (supplies for an aging parent with a Strands display simulator), CareLoop (family-care coordinator), Bellwether ("speech is a vital sign"). Non-health strong entries: Counterpart (profile-driven small-business MCP with MCP Apps, golden-phrase tests), DID IT (evidence receipts), Northbridge, Dwell, Spoken Letter (dual-era server), JudgeGuard, FixProof, Macro Pulse (195 tests, live on Appstore). Three of six judges are Alexa+ evangelists and Emerson Sklar has a voice-testing background; conversational quality will be graded hard. Two community simulators exist (AlSayedGamal's `mcp-voice-simulator` with OAuth 2.1 PKCE, conformance checker, MCP Apps iframes; KayLerch's `alexa-skill-mcp-bridge` that fronts an MCP server with a classic Alexa Skill and a Strands agent on AgentCore so it can be demoed on a physical Echo).

### 3.3 Implication

We build a spec-exact MCP server over the VisitProof backend (tools such as `get_visit_status`, `list_todays_visits`, `explain_exception`, `confirm_visit_note`, resources for schedules, a prompt for the morning briefing, `confirmed` argument fallback for confirmations, optional MCP Apps card), plus a thin browser "Echo Show" simulator that mirrors Amazon's simulator layout. It strengthens Tech Implementation and Quality of Idea for the Ring entry ("agent-ready, cross-device ecosystem understanding"), gives the AWS Builder story a second hook (Strands client, AgentCore Runtime hosting), and can be entered as an Alexa+ secondary if it is polished by day 20. It never gets more than 15% of the build budget.

---

## 4. Fire TV Research (Why Not)

- Vega OS (Linux, React Native for Vega, Chromium 144 WebView) is Amazon's future for all Fire TV Sticks; Fire OS (Android without Google Play) persists on Cube, Omni TVs, and 2026 smart TVs. The Vega SDK 0.24 requires macOS (Apple Silicon for WebView in the virtual device) or Ubuntu; Windows is unsupported.
- **No Fire TV has a built-in camera**; Vega exposes no camera or microphone API; USB webcams work only on Fire OS Cube/Omni; the remote microphone is closed to third parties everywhere. The organizer's "computer vision fitness app using the TV camera" hint is only feasible as phone-as-camera streaming landmarks to the TV, or on Fire OS with a USB webcam.
- Web apps: Fire OS hosted/packaged HTML5 submissions were discontinued in December 2024; on Vega, a Next.js static export inside an RN WebView shell is feasible but judges (two RN TV specialists on the panel, one of whom wrote the multi-TV starter) may read web-in-WebView as "not really a TV app." VSK voice integration is dead; Content Launcher and Vega Media Controls are the replacements.
- Public competitors already cover "TV as care surface" (Wick: Fire TV + Ring + Bee + Alexa+; Guardian Screen), AI audio description (Sightline), ambient scenes (ambient-frames), co-viewing (aura-vega-tv).
- Prize is $25K, but estimated ~295 entries with expert judges and a toolchain learning curve for a web-first team. Jev feasibility for a Fire TV care surface: 0.29.

Implication: not our primary. A Fire TV or Echo Show "family view" is a stretch surface we can mention as a roadmap item, not build.

---

## 5. Bee Research (Why Not)

- Bee is a $49.99 audio wearable (US shipping only) plus a free iOS app and an Apple Watch app (foreground-only, battery drain per App Store reviews). Developer access is one path: enable Developer Mode (Settings, About, tap App Version five times), then `@beeai/cli` (`bee login`) which is also the MCP server (35 tools), a local proxy, and a Node library. The raw API sits behind a private CA. Data objects: conversations with utterances and speaker labels, facts, todos, daily summaries, journals, insights, locations, photos, change feed, SSE stream with 13 event types.
- The hackathon FAQ says Developer Mode on Android appears only after pairing a device; iOS behavior with only an Apple Watch is undocumented. The founder is in Kenya, hardware cannot ship there, and iPhone/Watch availability is unknown. Jev feasibility: 0.10.
- Priority use cases (education, developer experience, personal productivity) sit far from the founder's domain; public entries (bee-bystander consent ledger, Ringfence, DayTrace, Bellwether, Kept) are unusually creative for a small field.

Implication: excluded. If an iPhone and Apple Watch become available, the Bee report in the scratchpad lists a caregiver clinic-visit capture idea, but it would be a separate project.

---

## 6. AWS Builder and Open Source Research

### 6.1 What counts

"Use AWS services (Bedrock, AgentCore, Strands SDK, Kiro Crew, SageMaker, etc.) in your project with documented integrations." Kiro Crew alone qualifies as a development tool. Judge Emerson confirmed on the forum that Claude Code on Bedrock also counts. The write-up goes in the Product Feedback field and the README; judges cannot infer integrations, so an `docs/aws-integrations.md` with a diagram, a service table (service, purpose, file path, observed cost), IAM snippets, and console screenshots is the deliverable.

### 6.2 Services we will use and why (September 2026 facts)

| Service | Role in VisitProof | Cost reality |
|---|---|---|
| Amazon Bedrock, Nova 2 Lite via Converse (`global.amazon.nova-2-lite-v1:0`) | Plain-language daily narratives for families and schedulers; snapshot description (objective, no identity) when media is available; never a decision-maker | $0.30 / $2.50 per 1M tokens; a few dollars for the whole hackathon |
| Amazon Bedrock Guardrails | PII and grounding filters on every generated narrative | cents |
| Amazon Rekognition `DetectLabels` | Cheap, deterministic labels on watermark-cropped snapshots (person, bag, uniform-like clothing, vehicle) to enrich arrival evidence; never faces | ~$0.001 per image |
| Strands Agents (TypeScript SDK preview, or Python) | The "ops copilot" agent that answers scheduler questions using VisitProof's own MCP tools; also the Alexa+ simulator brain | free; model calls only |
| Amazon Bedrock AgentCore Runtime (or Gateway) | Hosts the MCP server as a JWT-protected Streamable HTTP endpoint for the agent story; Gateway can front Lambda tools with Cognito JWT | per-second compute; ~$1 to $2 for the demo window |
| Amazon Cognito | OAuth 2.1 authorization code + PKCE for the MCP server (Alexa+ compatible, static client) | free under 10K MAU |
| AWS Lambda + API Gateway HTTP API | Webhook receiver (fast 202) and emulator delivery target; always-free tier | ~$0 |
| Amazon DynamoDB (on-demand) | Event log, visits, schedules, tokens (encrypted with KMS) | cents |
| AWS KMS | Envelope encryption for Ring tokens and signing key for evidence exports | cents |
| Amazon S3 | Snapshot storage with lifecycle expiry; signed evidence packs | cents |
| Amazon SES | Family and scheduler email (SMS via SNS is restricted on new accounts; do not promise SMS) | cents |
| AWS Amplify Hosting Gen 2 | The Next.js console (SSR, App Router); verify Next.js 16 support at build time; fall back to ECS Express Mode (App Runner closed to new customers April 2026) | free allowances |
| Kiro IDE/CLI + Kiro Crew | Specs, steering, hooks, and Crew jobs committed under `.kiro/`; qualifies on its own | Kiro Pro $20 for the month is advisable |

Estimated total AWS spend for the hackathon: roughly $22 to $35, far under the $150 promotional credits (form due 21 October, 12 PM PT) plus the $200 new-account credit. Mock everything behind adapters (`FixtureLLM`, recorded Rekognition responses) until integration week. Set AWS Budgets alarms at $50 and $100 on day one; tag every resource `Project=visitproof`.

### 6.3 Open Source mini challenge

New repo with a detectable OSI license (Apache-2.0 recommended: patent grant, matches Strands, Kiro Crew, and AgentCore samples), or a PR/branch/fork to a public repo, made during the window. Judges "value creative contributions over obvious ones (meaningful features with tests, bug fixes, new integration patterns)." Our plan: the VisitProof monorepo itself under Apache-2.0, plus a standalone, reusable package published to npm during the window, `@visitproof/ring-partner-sdk` (typed Ring Partner API client, webhook verifier and v1.1 payload schemas, WHEP browser helper, snapshot 303 helper, and a TypeScript emulator that sends signed webhooks), which fills a gap Ring itself acknowledges ("There is no official Ring Partner SDK"). Hacktoberfest 2026 dropped PR counting, so no overlap mechanics apply.

---

## 7. Competitive Landscape (What Judges Will Have Already Seen)

### 7.1 Public 2026 entries, Ring track

| Entry | Audience | Core idea | Notable strengths | Gaps we exploit |
|---|---|---|---|---|
| StillThere | Adult children of elders | Learns routine from 42 days of history; alerts on missing activity; 95th-percentile deadlines | 124 tests, explainable alerts, time injected everywhere | No UI, account linking incomplete, no schedule concept, family-only |
| Nightlight | Dementia families | Night door events trigger a family voice message on the chime before escalation; CASAS evaluation; MCP endpoint | Quantified restraint (94.5% fewer alarms), evidence-driven README, `ring-webhook-kit` on npm | Night-only, family-only |
| Ring Med Watch | Families | 12-hour inactivity email via Bedrock Haiku + SES | Simple | No HMAC, no UI, single contact |
| CareDoor | Families of older adults | Matches arrivals to expected care visits; Next.js + shadcn; Bedrock; SQS; DynamoDB | Closest to us on data shape | Family-only, no agency, no EVV, no reliability analytics, no scheduling import |
| Attest | Households and coordinators | Tamper-evident signed visit records; Ed25519 hash chain; offline verifier; 210 tests; ships ring-sandbox | Exceptional engineering rigor | Explicitly "never EVV", single active visit per site, single admin, no agency workflow, Bedrock throttled, FastAPI UI |
| CareRelay | Caretaking | Deterministic event reducer with human approval | Policy-safe | Thin product |
| Doorstep | Blind and low-vision users | Spoken objective descriptions via Nova Pro; watermark excision; refusals | Honest provenance, accessibility audit | Accessibility lane, not ours |
| WAVE | Deaf and hard-of-hearing residents | Gesture recognition, chime audio, Alexa+ MCP | Multi-surface | Accessibility lane |
| DoorSignal | Households | Visitor and delivery workflows, QR check-in | Workflow UI | Consumer visitor management |
| DockLedger | Warehouses | Detention invoices reconciled against motion history | Business systems | Logistics |
| ring-sandbox | Developers | Python emulator | Fills a real gap | Not a product |

Also announced or observed elsewhere: Wick and Guardian Screen (Fire TV entries that integrate Ring), InnerOS Ambient Guardian (Alexa+ primary with a Ring-compatible simulator).

### 7.2 Past Amazon hackathon winners (patterns that repeat)

From the AWS AI Agent Global Hackathon (EcoLafaek, AegisAgent, Province), the Amazon Nova AI Hackathon (Project Memoria, Dear-Care, Kisan-Mitra), Code with Kiro (LiverTracker, Healthcare Worker Burnout, Faxi), the AWS Health AI Hackathon (LVEF extraction, Clinic Sense), and the Alexa Skills Challenges (VoicePT, Senior Stretch, Ask My Buddy, Family Journal): winners name a specific human and place, use the featured tech deeply and visibly, ship a complete product feel, lead with one quantified claim, and show cross-surface orchestration. Health, care, and accessibility win repeatedly across Amazon hackathons. Videos open with the pitch on a real surface and end with "what's next."

### 7.3 Judge profiles (public record)

| Judge | What they publicly value | How VisitProof speaks to them |
|---|---|---|
| Chris Traganos | Friction logs ("critical for everyone to dogfood"), clean DX, code samples | A structured friction log with severity and suggestions; a judge quick start in three commands |
| Kourtney Meiss | Agent orchestration with clear roles and observability; restraint | Strands ops copilot over MCP tools with traces in AgentCore Observability; deterministic rules decide, models narrate |
| Giovanni Laquidara | Wrote `ring-api-helloworld` and the Fire TV starters; Strands and Bedrock | Real HMAC verification (his sample skips it), correct v1.1 schemas, WHEP done properly, a TypeScript SDK that improves on the sample |
| Anisha Malde | React performance, bundle hygiene, cross-platform structure; bioengineering MSc | Clean Next.js 16 App Router, shadcn discipline, a health product with honest clinical boundaries |
| Moses Roth | Community, clear story | A Devpost description a non-engineer follows; a caregiver, a scheduler, a daughter in the video |
| Emerson Sklar | Demos that "look, feel, sound functional"; testing rigor; conversational quality | Conformance tests for the MCP server, golden utterances for the simulator, replayable scenarios, edge cases handled on camera |

---

## 8. Market Research: Home Care, EVV, Families

### 8.1 The industry

- US home care providers market: roughly $113 billion (2026, Fortune Business Insights / IBISWorld framing) to $173.6 billion (IBISWorld "home care providers" 2026 estimate); 7 to 8% annual growth; 33,000 to 35,000 agencies (about 11,500 Medicare-certified); 3.5 million workers (1.84 million home health, 1.7 million personal care aides); median agency revenue $2.3 million; caregiver wages 62% of cost; net margin about 10%.
- Payer mix: Medicare 38%, Medicaid 28%, private pay 22%, other 12%.
- Caregiver turnover: 75 to 77% annually; top agencies under 40%.
- Demand: about 10,000 Americans turn 65 every day; 71.6 million aged 65+ by 2030; home care averages $4,500 per month versus $9,000+ assisted living and $10,500+ nursing facilities.
- Agency pain points in 2026 surveys: caregiver shortage (53%), profitability concerns (up from 13% to 34%), and operationally "missed visits, late clock-ins, expired certs, GPS drift on EVV, and a coordinator working the phones at 6am trying to backfill a call-out." Families "are frequently left in the dark about their loved one's daily care, which quietly erodes the trust the entire business depends on."

### 8.2 Electronic Visit Verification (EVV)

- Mandated by Section 12006 of the 21st Century Cures Act for Medicaid-funded personal care services (since 1 January 2020) and home health services (since 1 January 2023); non-compliant states face FMAP reductions up to 1%.
- Six required data elements: type of service, individual receiving the service, individual providing the service, date of service, location of service delivery, time the service begins and ends.
- State models: Provider Choice, MCO Choice, State Mandated In-house, State Mandated External Vendor, Open Vendor. Many states run a Sandata or HHAeXchange aggregator and allow "alternate EVV" vendors that submit visits via the Open EVV real-time JSON interface (Basic Auth, case-sensitive segment names, UTC timestamps, `VisitChanges` segment with reason codes; "only Verified visits are available for claims match").
- Accepted verification methods: GPS mobile clock-in, telephony (IVR from the client's landline), and fixed visit verification devices (FVV or "fob" devices placed in the client's home that generate time-bound codes).
- 2026 enforcement shift: states are moving from soft edits (paid with warnings) to **hard edits** (automatic denial when no matching verified visit exists): Missouri claims validation hard launch 1 April 2026; Minnesota from January; Ohio spring; Indiana and Pennsylvania later in 2026; Massachusetts no earlier than July 2026. Compliance thresholds around 85% (Pennsylvania, Florida) to 90% (New York). Remediation cycles for denied claims take weeks, creating cash-flow crises for small agencies.
- GPS problems: one proof-of-presence vendor (Movo) cites a 56% GPS match rate for GPS-based EVV; GPS spoofing apps are openly discussed by caregivers who want to hide their location; rural coverage gaps and "GPS drift" are recurring vendor talking points. Agencies spend coordinator time on "visit maintenance" (manually fixing unverified visits with reason codes), which itself is an audit risk.

### 8.3 Why a doorbell is a credible fixed visit verification signal

- A Ring doorbell is already installed at the client's door, is owned and controlled by the family (consent-native), and produces timestamped, cryptographically signed, server-delivered events (`button_press`, `motion_detected` with `sub_type: human`) that cannot be spoofed from a caregiver's phone.
- It observes the two moments EVV cares about most (arrival and departure) at the location EVV cares about (the client's home), independent of the caregiver's device.
- It cannot identify who arrived (and must not); therefore VisitProof's claim is precisely bounded: **"a person arrived at and left the client's door within the scheduled window, corroborated by the caregiver's own clock-in"**, never "this specific person was present." That framing is both honest and exactly the corroboration signal agencies lack when a GPS clock-in is missing, late, or suspicious.

### 8.4 Who pays and how much (assumptions to validate)

- Agency SaaS: $3 to $6 per enrolled client per month (a 60-client agency pays about $180 to $360 per month), positioned against the cost of a single denied claim (a typical personal-care visit bills $80 to $150; a week of denials for one client exceeds the annual subscription).
- Family plan through the Ring Appstore: $4.99 per device per month (Ring keeps 10%), for families who want the transparency feed and the evidence export even when the agency has not adopted VisitProof.
- Distribution: Ring Appstore (elder care category, US), direct agency sales, and partnerships with agency-management platforms (AxisCare, WellSky, AlayaCare, HHAeXchange) via the alternate-EVV export.

---

## 9. Whitespace and Differentiation (Explicit)

| Dimension | Family monitoring apps (StillThere, Nightlight, Density, Beside) | Household visit records (Attest, CareDoor) | VisitProof |
|---|---|---|---|
| Primary user | Adult child | Household or coordinator | Agency scheduler and compliance lead; family as consenting partner; caregiver as fair-record beneficiary |
| Unit of value | "Is Mom okay?" | "Did the visit happen?" | "Will this claim get paid, and can I fix today's no-show before 9am?" |
| Data joined | Ring events only | Ring events plus self-report | Ring events, agency schedule, caregiver EVV clock-in, authorized units |
| Output | Alerts | Signed record | Real-time exceptions, reconciliation, alternate-EVV export, reliability analytics, family feed, agent tools |
| Evidence stance | Alerts on absence | Signs what was observed | Signs observations and keeps three columns separate: observed at the door, reported by the caregiver, resolved by the agency |
| Regulatory hook | None | Explicitly none | EVV hard edits, six data elements, aggregator export shape |
| Ecosystem story | Ring | Ring + AWS | Ring + AWS + MCP (Alexa+, agents) |

Differentiators we will say out loud in the video: agency-first; EVV-aware; corroboration not surveillance; works on events alone (TAKE-safe); three-column evidence; export a payer can act on; agent-ready.

---

## 10. Decision Analysis (Expected Value and the Jev Run)

### 10.1 Volume and odds model

Registrants 15,814 (likely 17,000 to 19,000 by the deadline); Devpost conversion for Amazon events 5.5 to 7.5%; central estimate ~1,050 submissions. Track entries (multi-track allowed): Alexa+ ~440, Fire TV ~295, Ring ~145, Bee ~115. Stage One pass rate ~65%; serious contenders ~12% of entries. For a top-decile entrant (2x the odds of an average serious contender): Ring P(prize) ≈ 24% with two slots, Alexa+ ≈ 11% with three slots, Fire TV ≈ 17%, Bee ≈ 29% but with feasibility near zero for us. Risk-adjusted expected cash: Ring ≈ $2.2K, Fire TV ≈ $1.8K, Alexa+ ≈ $1.5K, Bee ≈ $0.6K without hardware. Entering the same product in Ring (primary) and Alexa+ (secondary) raises P(any track prize) to roughly 30%.

### 10.2 Jev concept scoring (TypeSafe, model jev-latest, 27 September 2026)

Twelve candidates were scored on the four judge criteria (Score questions with concrete levels), plus three Noul judgments (saturation, feasibility, founder fit), then combined in code as `judgeScore × feasible × (1 − 0.5 × saturated) × (0.8 + 0.2 × founderFit)`.

| Rank | Candidate | Tech | Design | Impact | Idea | Saturated | Feasible | Founder fit | Composite |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Ring: agency proof-of-presence and EVV ops (VisitProof) | 0.71 | 0.56 | 0.98 | 0.73 | 0.25 | 0.71 | 0.85 | **0.450** |
| 2 | Ring: post-discharge transitional care monitoring | 0.56 | 0.52 | 0.57 | 0.60 | 0.15 | 0.65 | 0.72 | 0.319 |
| 3 | Ring: incident evidence pack for small business | 0.67 | 0.54 | 0.47 | 0.54 | 0.20 | 0.69 | 0.19 | 0.289 |
| 4 | Ring: developer tooling (HA/MQTT bridge + SDK) | 0.75 | 0.36 | 0.24 | 0.47 | 0.20 | 0.73 | 0.13 | 0.247 |
| 5 | Alexa+: chronic-condition voice coach | 0.41 | 0.48 | 0.33 | 0.31 | 0.22 | 0.65 | 0.51 | 0.199 |
| 6 | Alexa+: family and agency care coordination MCP | 0.42 | 0.55 | 0.42 | 0.14 | 0.78 | 0.75 | 0.64 | 0.162 |
| 7 | Ring: expected-visitor gatekeeper (access control) | 0.49 | 0.52 | 0.37 | 0.34 | 0.57 | 0.55 | 0.14 | 0.141 |
| 8 | Ring: staff time and attendance | 0.47 | 0.53 | 0.32 | 0.25 | 0.55 | 0.57 | 0.20 | 0.136 |
| 9 | Ring: Deaf/HoH doorbell relay | 0.49 | 0.39 | 0.40 | 0.25 | 0.77 | 0.61 | 0.17 | 0.120 |
| 10 | Ring: dementia wander guard | 0.51 | 0.42 | 0.41 | 0.17 | 0.85 | 0.31 | 0.38 | 0.059 |
| 11 | Fire TV: TV as care surface | 0.23 | 0.38 | 0.34 | 0.18 | 0.75 | 0.29 | 0.49 | 0.046 |
| 12 | Bee: caregiver clinic-visit capture | 0.14 | 0.10 | 0.22 | 0.48 | 0.23 | 0.10 | 0.42 | 0.018 |

Direct choice questions: best overall concept = VisitProof (confidence 0.99); best track = Ring (0.97), Alexa+ 0.02, Fire TV 0.01, Bee 0.00. Name selection in a second run: VisitProof 0.91 over ShiftProof, CareArrive, PresenceLedger, Threshold, DoorMark, Arrivo, Sentry (Sentry flagged as the most surveillance-flavored, 0.99). The `visitproof` npm name is unregistered and no GitHub project uses it.

### 10.3 What the scores tell us to fix

- Design (0.56) is the weakest judge criterion for our concept: multi-role products can sprawl. Mitigation: three tightly scoped surfaces (Scheduler console, Family portal, Caregiver record link), one hero flow per role, empty and error states designed up front, shadcn discipline.
- Feasibility (0.71) hinges on Ring developer registration (government ID) and on emulated events. Mitigation: register on day one; build the emulator in week one; keep Playground calls for real API proof.
- Saturation (0.25) is low but not zero because of Attest and CareDoor. Mitigation: agency-first framing, EVV reconciliation, exports, and analytics that neither has; say the difference explicitly in the README.

---

## 11. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Ring identity verification fails or stalls (three attempts, exact legal name match) | Medium | High (no Playground) | Register on day one with passport; match the Company Profile name exactly; keep the emulator as a full fallback so the build never blocks |
| Playground sandbox has no motion or doorbell events | Certain | Medium | Emulator delivers signed v1.1 webhooks; Playground used for devices, capabilities, history, and WHEP frames; provenance labels |
| TAKE encryption returns unreadable media | High for real customers | Medium | Event-only core; media optional; explicit "encrypted device" state |
| Scope creep across roles and the Alexa+ secondary | High | High | Feature freeze on day 16; MCP capped at 15% of effort; cut list defined in build.md |
| Health or compliance overclaim ("EVV-compliant", "identifies the caregiver") | Medium | High (credibility, policy) | Language guardrails: "corroborates", "proof of presence at the door", "not an EVV system of record", "no identity inference"; three-column evidence |
| AWS account limits (SES sandbox, SNS SMS) | High | Low | Email only; verified sender; no SMS promises |
| Bedrock throttling (Attest hit this on the free tier) | Medium | Low | Fixture fallback with labeled provenance; narratives are optional |
| Next.js 16 on Amplify Hosting unsupported at build time | Medium | Medium | Test deploy in week one; fallback ECS Express Mode or Vercel for the console while keeping backend on AWS |
| Video over 3 minutes, copyrighted media, private repo not shared | Low | Fatal | Checklist in info.md; use only our own footage and Nova-generated imagery; submit 24 hours early |
| Judges see Attest/CareDoor first and pattern-match | Medium | Medium | Lead the video and README with the agency scheduler at 6am and the denied claim, not with the doorbell |

---

## 12. Friction Log Seeds (Known Before We Start)

1. Ring docs prerequisites say "at least one Ring device" while the hackathon says none required; the Playground does not emit motion or doorbell events.
2. Playground tokens last 30 minutes with no refresh and cannot deliver webhooks to localhost.
3. `event_types` filter reportedly ignored on the history endpoint; plural syntax not obvious from docs.
4. Official sample app does not verify HMAC and uses an outdated 1.0 payload schema.
5. Credentials shown once; no regeneration; delete-and-recreate is the only fix.
6. Sensors and chimes are Early Access; no publish path yet.
7. Watermark band size is not documented in pixels; must be measured.
8. TAKE encryption status is not yet exposed per device.
9. Alexa+ tooling is partner-gated; the documented client initializes with 2025-03-26 while the overview requires 2025-11-25; auth guidance differs between the QuickStart and the account-linking page.
10. AgentCore npm CLI shadows the older Python CLI; App Runner closed to new customers; Amplify's Next.js 16 support must be re-verified.

---

## 13. Design System Research (shadcn/ui)

See Section 13 addendum below (filled from the full sweep of ui.shadcn.com) and the component-level rules in [build.md](./build.md).

### 13.1 What shadcn/ui is in September 2026 (facts the build must respect)

- shadcn/ui is a code distribution system, not a component library on npm. The CLI copies component source into the repo (`components/ui/*`), and you own the code. Updates are opt-in via `pnpm dlx shadcn@latest add <component> --diff`.
- **Base UI is the default primitive library since July 2026** (Base UI 1.6+, built by the Radix team). Radix and React Aria remain supported; every component ships for all three. The `base` field in `components.json` decides the API: Base UI uses `render={<Comp />}` where Radix used `asChild`; Base UI `Select` takes an `items` array with a `{ label, value: null }` placeholder; `ToggleGroup` and `Accordion` use a `multiple` boolean with array values; `Slider` single thumb takes a number; the Base UI `toast` component (`toast.add({...})`) replaces Sonner; `Combobox` is first-class; `Drawer` is Base UI (Radix keeps Vaul).
- Tailwind CSS v4 with `@theme inline` and OKLCH tokens is standard; React 19 fully supported; no `forwardRef`; every part sets `data-slot`; since September 2026 `cn` comes from the standalone `cn` package (`lib/utils.ts` re-exports it).
- Visual styles: Nova (default, balanced density), Vega (classic shadcn), Maia (softer), Lyra (sharp), Mira (dense, data heavy), Luma, Sera (editorial), Rhea. Base UI styles are prefixed `base-` (`base-nova`). Base colors: neutral, stone, zinc, mauve, olive, mist, taupe. Icon libraries: lucide (default), tabler, hugeicons, phosphor, remixicon, radix.
- Forms use the `Field` family (`FieldSet`, `FieldLegend`, `FieldGroup`, `Field`, `FieldLabel`, `FieldDescription`, `FieldError`, `FieldContent`, `FieldTitle`, `FieldSeparator`) with React Hook Form or TanStack Form; the legacy `Form`/`FormField`/`FormMessage` wrappers are retired.
- Components added in 2025 to 2026 that we will use: Button Group, Input Group, Field, Item, Empty, Kbd, Spinner, Native Select, Direction, Toast (Base UI), chat components (Message, Bubble, Message Scroller) for the Alexa+ simulator transcript, and Questionnaire (multi-step flows) for onboarding.
- Charts wrap Recharts 3.x through `ChartContainer` + `ChartConfig` + `ChartTooltip`/`ChartLegend`, colored with `var(--chart-1)` to `var(--chart-5)` and `var(--color-<key>)`; every chart block is a `Card`; `accessibilityLayer` on.
- Sidebar: `SidebarProvider` + `Sidebar` (variants `sidebar`, `floating`, `inset`; collapsible `offcanvas`, `icon`, `none`) + `SidebarInset` + `SidebarTrigger`; cookie-persisted state; `Cmd+B` shortcut; mobile renders in a `Sheet`. Block `sidebar-07` (collapses to icons) is the canonical app shell; `dashboard-01` is the canonical dashboard (section cards, interactive area chart, TanStack data table with drawer detail).
- Theming tokens (light and dark): `background/foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `chart-1..5`, `sidebar-*`, `radius` (0.625rem default, proportional `sm` to `4xl` scale). New intents (for example `success`, `warning`) are added as OKLCH variables in `:root`/`.dark` plus `@theme inline` mappings, then as `cva` variants; this is the documented extension path.
- Typography has no component; use the documented utility recipes (h1 to h4, p, lead, large, small, muted, inline code, list, blockquote) or Typeset (`typeset typeset-docs`) for rendered markdown.
- Tooling: `pnpm dlx shadcn@latest init -t next --monorepo` scaffolds a Turborepo with `apps/web` and `packages/ui`; every workspace needs a `components.json` with matching `style`, `iconLibrary`, `baseColor`; the shadcn MCP server (`pnpm dlx shadcn@latest mcp init --client claude`) and the official agent skill (`pnpm dlx skills add shadcn/ui`) let AI assistants add and audit components; `shadcn info --json` reports project state.

### 13.2 The "strictly shadcn" rule set we adopt (enforced in code review)

1. Add components only through the CLI; never hand-write `components/ui/*`.
2. Semantic tokens only (`bg-background`, `text-muted-foreground`, `bg-primary text-primary-foreground`, `border-border`, `var(--chart-n)`); no raw palette classes, no hex in components, no manual `dark:` color overrides.
3. Built-in variants and sizes before any className; className is for layout only.
4. `cn()` for conditional classes; `flex gap-*` not `space-*`; `size-*` for squares.
5. Base UI composition everywhere (`render`, `items`, `multiple`, numbers for single sliders).
6. Items inside their groups (`SelectGroup`, `DropdownMenuGroup`, `CommandGroup`, `TabsList`).
7. Every overlay has a Title; Card uses full composition; Avatar always has a Fallback; loading buttons are `disabled` with a `Spinner`; Empty for empty states; Alert for callouts; Separator for dividers; Skeleton for loading; Badge for status; Item for list rows; Kbd for shortcuts.
8. Forms with `FieldGroup`/`Field`/`FieldLabel`/`FieldDescription`/`FieldError` and React Hook Form `Controller`; `InputGroup` for adorned inputs; `ToggleGroup` for 2 to 7 options.
9. Icons from `lucide-react` only, positioned with `data-icon="inline-start|inline-end"`, no manual sizing.
10. Toasts via `toast.add()` from `@/components/ui/toast`; `TooltipProvider`, `ThemeProvider`, and one `Toaster` at the root.
11. Charts through `ChartContainer` with `ChartConfig`; tables through `Table` + TanStack Table v9 per the Data Table guide.
12. Typography recipes only; Title Case for titles and buttons; no dashes in copy (house rules layered on top).

---

## 14. Sources

### Hackathon
- https://amazonappdev2026.devpost.com/ ; /rules ; /resources ; /details/faqs ; /details/dates ; /updates ; /project-gallery ; /forum_topics
- https://community.amazondeveloper.com/t/build-ship-shape-amazon-developer-hackathon/29097 (also 29098, 29099)
- https://community.amazondeveloper.com/t/aug-31-2026-hackathon-ring-updates/29048
- https://dev.to/amazonappdev (Dev News 24 Aug, 31 Aug, 8 Sep, 14 Sep, 21 Sep 2026)
- https://builder.aws.com/content/3JP06xAFFqTUXpD9kECgYcjVHWQ/aws-hackathons-still-open-build-compete-and-ship-before-october-ends

### Ring
- https://developer.amazon.com/docs/ring/get-started.html ; api-documentation.html ; develop.html ; configure.html ; certify.html ; publish.html ; reports.html ; ring-mcp.html ; ux-design-guide.html ; content-policy.html ; program-requirements.html ; developer-faq.html ; release-notes.html ; marketing-guidelines.html
- https://developer.ring.com/ ; https://ring.com/appstore ; https://ring.com/ring-ai-features
- https://github.com/AmazonAppDev/ring-api-helloworld ; https://github.com/josepha-mayo/ring-sandbox ; https://glama.ai/mcp/servers/SwaggyXO/ring-vision-mcp
- https://community.amazondeveloper.com/c/ring/53 (threads on staging motion events, test users, account linking, snapshots, deep links, certification, billing)
- https://techcrunch.com/2026/03/31/ring-app-store-bets-on-ai-to-go-beyond-home-security/ ; https://blog.ring.com/about-ring/introducing-the-ring-appstore-ring-cameras-just-got-smarter/ ; https://www.androidauthority.com/ring-camera-upgrades-2026-3630132/
- https://www.aboutamazon.com/news/devices/ring-take-encryption ; https://www.aboutamazon.com/news/devices/ring-video-descriptions-gen-ai ; https://www.geekwire.com/2026/what-rings-search-party-actually-does-and-why-its-super-bowl-ad-gave-people-the-creeps/
- Competing entries: https://github.com/gtogbes/still-there ; https://github.com/usv240/nightlight ; https://github.com/iancuileana83-lab/ring-med-watch ; https://github.com/venkatgkasturi/caredoor ; https://github.com/josepha-mayo/attest ; https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/110 ; https://github.com/AtchayamG/doorstep-ring ; https://github.com/321abdulfatah/wave ; https://github.com/AmirmLotfy/doorsignal ; https://github.com/HamzaSeyfu/dockledger ; https://github.com/rogerjeasy/wick ; https://github.com/mooknayak/guardian-screen ; https://github.com/Rafa-Innerchispa/inneros-ambient-guardian-amazon-2026

### Alexa+ and MCP
- https://developer.amazon.com/alexaplus/ ; https://developer.amazon.com/alexaplus/blogs/2026/07/alexa-plus-new-ways-to-build-experiences
- https://developer.amazon.com/docs/alexaplus/add-ons/overview.html ; mcp-toolkit-overview.html ; mcp-toolkit-quickstart.html ; mcp-toolkit-client-lifecycle.html ; mcp-toolkit-authentication.html ; mcp-toolkit-account-linking.html ; mcp-addon-design-guide.html ; mcp-addon-tools-schema-data-design.html ; mcp-addon-components-and-patterns.html ; mcp-addon-conversation-surface.html ; mcp-addon-display-modes.html ; test-with-web-simulator.html ; certification-guidelines.html ; payments-overview.html
- https://modelcontextprotocol.io/specification/2025-11-25 (changelog, transports, lifecycle, authorization, tools, resources, prompts, elicitation, tasks) ; https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp ; https://apps.extensions.modelcontextprotocol.io/api/
- https://github.com/modelcontextprotocol/typescript-sdk ; https://agentskills.io/specification ; https://code.claude.com/docs/en/skills
- Competing entries and tools: https://github.com/Raul99Alejandro/counterpart ; https://github.com/harrisjeffery04-stack/did-it ; https://github.com/skiitk2510/carecompanion ; https://github.com/chinesepowered/hack-amazon3 ; https://github.com/Mani91050/careloop ; https://github.com/AlSayedGamal/mcp-voice-simulator ; https://github.com/KayLerch/alexa-skill-mcp-bridge ; https://github.com/sechan9999/macropulse-alexa-mcp ; https://github.com/juan294/spoken-letter-alexa

### Fire TV and Vega
- https://developer.amazon.com/docs/vega/vega.html ; /0.24/vega-get-started.html ; /0.24/install-vega-sdk.html ; /0.24/mcp-server ; /0.24/develop-your-app-with-webview.html ; /0.24/focus-management.html ; /0.24/content-launcher-overview.html
- https://developer.amazon.com/docs/fire-tv/fire-os-overview.html ; web-app-faq.html ; design-and-user-experience-guidelines.html ; get-started-with-react-native.html
- https://github.com/AmazonAppDev/react-native-multi-tv-app-sample ; react-native-multi-tv-helloworld ; vega-video-sample ; vega-sports-app ; vega-tv-interfaces-sample ; hello-world-fire-tv
- https://www.aftvnews.com/amazon-confirms-all-future-fire-tv-sticks-will-run-vega-os-no-more-android-or-sideloading-on-new-models/ ; https://ftvdb.com/blog/2026-05-18-fire-tv-2026-device-list-shows-three-os-tracks/ ; https://www.callstack.com/ebooks/the-ultimate-guide-to-react-native-tv-development

### Bee
- https://docs.bee.computer/ (docs, developer-mode, cli, proxy, mcp, skill, realtime, sync) ; https://github.com/bee-computer/bee-cli ; https://github.com/bee-computer/bee-skill ; https://bee.computer/bee-pioneer ; https://bee.computer/blog/private-ai
- https://techcrunch.com/2025/07/22/amazon-acquires-bee-the-ai-wearable-that-records-everything-you-say/ ; https://www.aboutamazon.com/news/devices/bee-amazon-wearable-ai-device-new-features

### AWS
- https://aws.amazon.com/bedrock/pricing/ ; https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html ; https://aws.amazon.com/about-aws/whats-new/2025/12/nova-2-foundation-models-amazon-bedrock/ ; https://aws.amazon.com/bedrock/agentcore/pricing/ ; https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp.html ; https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway.html ; https://strandsagents.com/ ; https://www.npmjs.com/package/@strands-agents/sdk ; https://github.com/kirodotdev/KiroCrew ; https://kiro.dev/docs/crew/ ; https://kiro.dev/pricing/ ; https://aws.amazon.com/lambda/pricing/ ; https://aws.amazon.com/amplify/pricing/ ; https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html ; https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html ; https://aws.amazon.com/rekognition/pricing/ ; https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda

### Market and EVV
- https://www.medicaid.gov/medicaid/home-community-based-services/home-community-based-services-guidance-additional-resources/electronic-visit-verification
- https://www.hhaexchange.com/blog/everything-homecare-agencies-need-to-know-about-evv ; https://knowledge.sandata.com/sandata/Content/Documentation-SD/VendorSolutions/FAQ-SD-VS-General.htm ; https://eohhs.ri.gov/sites/g/files/xkgbur226/files/2024-12/RI%20Alt%20EVV%20Specifications%204.2.pdf ; https://www.in.gov/medicaid/providers/files/alternate-evv-specification-user-guide.pdf.pdf
- https://shiftcare.com/us/blog/evv-compliance-deadlines-2026-state-by-state-requirements-and-timeline ; https://mydss.mo.gov/mhd/hot-tips/electronic-visit-verification-claims-validation-hard-launch-begins-april-1-2026 ; https://www.aveecare.com/resources/evv-requirements-by-state-2026 ; https://timeero.com/post/evv-requirements-state ; https://www.myezcare.com/how-evv-compliance-works-in-2026-state-by-state-breakdown/
- https://movo.co/ ; https://www.freewheelintravel.org/evv-electronic-visit-verification-hide-gps-location/ ; https://alayacare.com/resource/blog/providing-the-proof-electronic-visit-verification-evv/
- https://www.aveecare.com/resources/home-care-industry-statistics-2026 ; https://www.ibisworld.com/united-states/market-size/home-care-providers/1579 ; https://www.homecaremag.com/news/survey-reveals-2026-homecare-agency-trends ; https://axiscare.com/blog/home-care-industry-trends/ ; https://emitrr.com/blog/how-home-health-agencies-can-reduce-missed-visits-caregiver-no-shows-and-scheduling-chaos/ ; https://www.forefront-technology.com/post/home-care-software-in-2026-why-paper-based-agencies-are-losing-money-staff-and-trust

### Past winners and Devpost guidance
- https://info.devpost.com/customer-stories/amazon-hackathons-on-devpost ; https://aws-agent-hackathon.devpost.com/project-gallery ; https://amazon-nova.devpost.com/project-gallery ; https://kiro.devpost.com/project-gallery ; https://awshealthai.devpost.com/project-gallery ; https://alexaskillsaging.devpost.com/project-gallery
- https://info.devpost.com/blog/6-tips-for-making-a-hackathon-demo-video ; https://info.devpost.com/blog/hackathon-judging-tips ; https://help.devpost.com/article/103-how-to-judge-an-online-hackathon

### Judges
- https://trag.dev/ ; https://kourtneymeiss.dev/ ; https://giolaq.dev/ ; https://www.anisha.dev/about-me ; https://mosesroth.github.io/ ; https://sklar.ai/

### Decision tooling
- https://docs.typesafe.ai/api.md ; https://docs.typesafe.ai/primitives/choice.md ; https://docs.typesafe.ai/primitives/score.md ; https://docs.typesafe.ai/sdk/javascript.md (runs recorded in `scratchpad/jev/decision-output.txt`)
