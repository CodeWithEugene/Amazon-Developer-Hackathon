# Devpost Additional Info

> Paste-ready answers for the "Additional info" form of the Build, Ship, Shape Amazon Developer Hackathon, in form order. Paste the text under each heading. Long answers are kept under about 2,500 characters; the full versions live in the repository (`docs/devpost-submission.md`, `docs/friction-log.md`, `docs/aws-integrations.md`).

---

## Submitter Type

Individual

## Organization Name

Technetium Kenya

## Country

Kenya

## Canada Province

N/A

## Primary Track(s)

Ring

## Repository URL

https://github.com/CodeWithEugene/Amazon-Developer-Hackathon

## New or Existing

New. The repository and all code were created during the submission period (first commit 27 September 2026, after the 31 August 2026 start).

---

## AWS Builder Mini Challenge

Yes

### AWS Services Write-Up

VisitProof's core backend is deployed on AWS with CDK (`infra/`): four stacks in us-east-1 (Data, Observability, Webhook, Engine), tagged Project=visitproof, deployed on 22 October 2026.

Verified end to end on 22 October 2026 with a synthetic Ring v1.1 webhook signed with HMAC-SHA256 over the raw body:
- API Gateway HTTP API and Lambda: signed request returned 202 in 815 ms; unsigned, wrong-key and tampered requests returned 401; a repeated request id returned 202 duplicate.
- DynamoDB: door event and an idempotency receipt with TTL stored.
- DynamoDB Streams and Lambda: the Presence Engine processor ran with 0 errors.
- KMS (ECC P-256): first ledger record signed with ECDSA SHA-256.
- EventBridge: visit sweeper runs every minute with 0 errors.
- CloudWatch, SQS, Budgets: alarms OK, dead letter queues empty, spend 0 USD.

Deployed but not exercised yet: S3 (snapshots with consent-based expiry, evidence packs), SNS alerts (no email subscriber yet).

Honest gaps: Bedrock (Nova 2 Lite via Converse) is wired for plain-language visit narratives, but the account's Nova 2 Lite quotas are 0, so calls are throttled and the template fallback is used. SES is coded and tested but not configured. Strands Agents, Cognito, AgentCore Runtime and Amplify are not deployed; the hosted console runs on Vercel with demo data. The webhook URL is not yet registered with Ring, so no real Ring traffic reaches AWS.

Every adapter is tested with aws-sdk-client-mock and can be switched on independently. Estimated cost: 3 to 5 USD a month. Full details and teardown: https://github.com/CodeWithEugene/Amazon-Developer-Hackathon/blob/main/docs/aws-integrations.md

---

## Open Source Mini Challenge

Yes

### Contribution URL

https://github.com/CodeWithEugene/Amazon-Developer-Hackathon/tree/main/packages/ring-partner-sdk

### Project Repository URL

https://github.com/CodeWithEugene/Amazon-Developer-Hackathon

### GitHub Username

CodeWithEugene

### What You Did, How It Works, And Why It Matters

VisitProof is a new Apache-2.0 project created during the hackathon. Its reusable centerpiece is `packages/ring-partner-sdk`, a typed TypeScript client for the Ring Partner API, since Ring has no official SDK. It includes webhook HMAC verification over raw bytes, v1.1 schemas that tolerate future Ring values and the real nullable fields, the account-link nonce, a token manager with single-flight refresh, a browser-safe WHEP helper that enforces Ring's session caps and ends a connected session that sends no video, real Playground responses as fixtures with a mock Ring Playground that serves them, and an emulator that delivers signed webhooks and multi-day scenarios. Any Ring developer can use it to test the event path without hardware, which was the biggest gap we hit. It ships with 132 tests in 14 files, and the rest of the repository shows it inside a complete product.

---

## Feature Requests

1. Critical (Ring Playground): Send signed test webhooks (motion_detected with sub_type, button_press) to a URL the developer supplies. Today the event path cannot be tested without hardware.
2. Critical (Ring API): Response examples with the real type names (device-status, device-capabilities, device-configurations, locations) and every nullable field. Strict validators written from the docs reject every real device payload.
3. Important (Ring Playground): A sandbox doorbell that streams sample video continuously, or a note next to the WHEP docs that video flows only during a simulated live view event.
4. Important (Ring API): Official test vectors for webhook signatures and account-link nonces, and an updated ring-api-helloworld that verifies X-Signature.
5. Important (Ring API): A JSON schema or OpenAPI document for the Partner API.
6. Important (Ring Playground): Pre-seeded history events of each type on the sandbox doorbell.
7. Nice-to-have (Ring API): TAKE mode exposed next to e2e_encryption, with a webhook on change.
8. Nice-to-have (Ring Playground): 24 hour developer tokens or a sandbox refresh token.
9. Nice-to-have (Ring Developer Console): Client secret rotation.
10. Nice-to-have (Alexa+): A public conformance checker for MCP add-ons and one consistent protocol version and auth page.

---

## Friction Log

Full log (18 entries, same format): https://github.com/CodeWithEugene/Amazon-Developer-Hackathon/blob/main/docs/friction-log.md

1. Ring Playground webhooks. Task: drive the webhook path from the sandbox doorbell. Steps: minted a token, called users/me, devices, history (with and without event_types), looked for a webhook setting. Expected: simulated events delivered or in history. Actual: history empty, no webhook URL. Severity: High. Workaround: built a signed v1.1 webhook emulator. Suggestion: a "Send test event" control in the Playground.

2. Real device payloads. Task: validate status, capabilities, configurations, location. Steps: ran our smoke script, compared raw bodies to schemas. Expected: documented type names and types. Actual: all 200, all rejected; undocumented type names and many nulls; Device Check showed 0 of 5. Severity: High. Workaround: captured fixtures, relaxed schemas, now 4 of 4. Suggestion: full response examples with nulls, or OpenAPI.

3. Live view with no video. Task: show the sandbox doorbell over WHEP. Steps: posted an SDP offer, watched WebRTC stats. Expected: sample video. Actual: ICE and DTLS connected, H264 negotiated, no media until a Playground "Simulate live view event" ran (then 250 frames at 1280x720). Severity: High. Workaround: end sessions with no frames after 8 seconds and say so. Suggestion: document the simulation requirement.

4. ring-api-helloworld signatures. Task: verify webhooks using the sample. Actual: it checks a static bearer token, not X-Signature, and uses an older schema. Severity: High. Workaround: implemented from docs with our own vectors. Suggestion: fix the sample and publish vectors.

5. Playground token lifetime. Task: keep a token alive while developing. Actual: about 30 minutes, no refresh. Severity: Medium. Workaround: record responses, mock Playground. Suggestion: longer developer tokens.

6. Alexa+ docs. Task: pick the MCP protocol version. Actual: client sends 2025-03-26, overview requires 2025-11-25. Severity: Medium. Workaround: negotiate both. Suggestion: publish the exact initialize payload.

---

## Project Testing Link

https://visitproof.codewitheugene.top

### Testing Instructions

Live demo: open https://visitproof.codewitheugene.top and use one-click Demo Sign In as Scheduler, Compliance Lead, Family Member, or Caregiver. It runs the console on demo data moved onto the current week. Ask VisitProof (/ask) needs the local MCP server, and live Ring mode is off on the hosted site.

Try: Scheduler, open an exception card, View Visit, Backfill Times, Resolve. Compliance Lead, choose Two Weeks, filter Contradicted, download the PDF evidence pack and Open EVV JSON. Family Member, the daily card, consent controls, /ask. Caregiver, a visit with a missing clock-in but door presence; add a note.

Local full demo (Node 22+, pnpm 10+, no AWS or Ring credentials needed):
git clone https://github.com/CodeWithEugene/Amazon-Developer-Hackathon.git
cd Amazon-Developer-Hackathon
pnpm install
pnpm demo
When it prints "VisitProof demo is ready", open http://localhost:3000. This seeds 84 visits, posts 181 signed webhooks to the real receiver, runs the engine and starts the MCP server for /ask. Change ports with PORT, WEBHOOK_PORT and MCP_PORT.

Live Ring mode: mint a 30 minute token in the Ring Developer Playground, save it with pnpm ring:token (reads the clipboard into .env), and run the console (README, Live Ring Mode). Device Check and Sync Ring History then read the sandbox doorbell. For live video, first start a Motion, Package or Vehicle "Simulate live view event" for the Playground Device, then select Start Live View on /family/live. Without a simulation the sandbox sends no video and VisitProof says so after 8 seconds.

---

## Feedback Questions

### 1. Which Amazon Or Partner Tools Did You Use, And For What?

Ring Partner API (devices, status, capabilities, configurations, location, history, WHEP live view, app integrations, v1.1 webhooks) and the Ring Developer Playground sandbox doorbell; Ring developer docs and ring-api-helloworld; AWS CDK, Lambda, API Gateway, DynamoDB and Streams, KMS, EventBridge, S3, SQS, CloudWatch, Budgets, Bedrock (Nova 2 Lite); the MCP TypeScript SDK for the Alexa+ style server; Next.js 16 with shadcn/ui; Vercel for the hosted demo.

### 2. What Worked Well?

Ring Partner API: clean JSON:API, fast 200s, and one devices call with include returns everything Device Check needs. Playground: a token in seconds. WHEP: signaling worked first time and, with a simulation running, we decoded real 1280x720 video. Ring webhooks docs: HMAC over raw bytes plus a request id is exactly what a reliable receiver needs. AWS CDK, Lambda, DynamoDB, KMS: four stacks deployed and verified in one day; KMS ECDSA signing made the ledger trustworthy with little code. MCP SDK: a spec-correct Streamable HTTP server with version negotiation was straightforward. Next.js and shadcn/ui: fast, accessible UI. Vercel: the demo console deployed in minutes.

### 3. What Needs Improvement?

Ring Playground: no webhooks, empty history, 30 minute tokens, subscriptions returns 422. Ring Partner API docs: real type names and nulls not shown, no OpenAPI. WHEP docs: the sandbox streams only during a simulated event, which is not written down. Ring webhooks: the sample skips signature verification. Bedrock: new accounts can have Nova 2 Lite quotas at 0 with no clear path in the console, so calls throttle. Amplify: unclear Next.js 16 support pushed hosting elsewhere. Alexa+: tooling is partner-gated and docs disagree on protocol version and auth. shadcn/ui: bulk install adds unused components.

### 4. How Was Onboarding?

Ring registration and identity verification were quick. Reaching a first real event was hard: docs require a Ring device while the hackathon says none is needed, and the real path (Playground for reads and live view, an emulator for events) became clear only from forum threads. AWS onboarding with aws login and cdk bootstrap was smooth.

### 5. Would You Build With These Tools Again?

Yes. Ring's installed base and signed events make proof-of-presence possible with hardware families already own, and AWS gave us a cheap, auditable backend. A Playground test-event button, a streaming sandbox doorbell and response examples with nulls would remove most of our friction.

---

## Eligibility Checkboxes

Check

Check

Check

---

## AI Tools Used

Claude Code (Anthropic) for planning, implementation, tests and documentation, and Kiro for spec-driven development (specs and steering in `.kiro/`, including the Presence Engine EARS spec).

## Learning Level

Significant

## AI Value

Yes
