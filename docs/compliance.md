# Compliance Posture and Ring Certification Draft

> Draft answers for the Ring Appstore certification questionnaire (General, Data Processing, AI Governance, Data Protection, Third Parties), the reviewer notes, and the privacy commitments VisitProof makes to agencies and families. These are written before the build ships so the product is designed to the answers rather than retrofitted. They also feed the Devpost "Potential Impact" section (path to the Ring Appstore).

## 1. General

- **Company:** Technetium Kenya (VisitProof product). Contact: eugenegabriel.ke@gmail.com.
- **App name:** VisitProof. The name, domain, and logo contain no Ring or Amazon marks.
- **Use case:** Proof of presence for scheduled home-care visits. Doorbell button presses and human-motion events at the client's door are matched to the agency's visit schedule and the caregiver's own EVV clock-in. Priority categories: caretaking and business systems.
- **App type:** Public app after certification; private app (up to 10 accounts) for pilots.
- **Scopes requested:** Cameras and Doorbells (motion events, doorbell presses, snapshots from recordings, time-boxed live view), Account and Lifecycle (integration status, device add and remove, online and offline, subscription events). Sensors requested only when Early Access reaches general availability. Chimes not requested in v1.
- **Subscription model:** Family plan $4.99 per device per month in the Ring Appstore; agency plan billed outside Ring.

## 2. Data Processing

| Question | Answer |
|---|---|
| What Ring data is collected? | Device metadata (name, online state, capabilities, motion and privacy zone presence), event metadata (`motion_detected` with `sub_type`, `button_press`, lifecycle and subscription events), event history for cameras and doorbells from the consent date, optional snapshots from recordings at arrival when the family enables them, and short live-view sessions initiated by the family. |
| What is not collected? | No continuous video, no audio, no clips in v1, no facial or biometric data, no interior cameras, no location beyond the coarse country and state the API returns. |
| Purpose | Confirm arrival and departure of a person at the door inside a scheduled visit window; raise exceptions to the agency; produce a signed record; reconcile with EVV clock-ins. |
| Legal basis and consent | The Ring account holder (family) selects devices in the Ring app and confirms; VisitProof shows a plain-language consent screen (what is shared, with whom, snapshot on or off, retention) that can be changed or withdrawn at any time in the Family Portal or in Ring My Apps. |
| Who sees what | Family: everything about their client. Agency staff: visit status, times, reconciliation, and snapshots only if the family opted in. Caregiver: door times and outcomes for their own visits, never snapshots. No cross-account or cross-client visibility. |
| Retention | Door events 90 days (agency configurable 30 to 365); snapshots 7 days (family configurable 1 to 30); signed evidence summaries 7 years for compliance without media; raw webhook receipts 30 days. |
| Deletion | Family one-click "Delete Everything"; agency deletion per client; Ring unlink triggers the same pipeline; backups expire on schedule; confirmation email sent. |
| Marketing or resale | Never. No advertising use, no sale, no profiling. |
| Disclosures to users | Consent screen, privacy policy page, in-app provenance labels, and a "what VisitProof is not" section. |

## 3. AI Governance

| Question | Answer |
|---|---|
| Models used | Amazon Bedrock Nova 2 Lite (narratives), Amazon Rekognition DetectLabels (non-identifying labels on a cropped snapshot), TypeSafe Jev (planned; bounded typed judgments: which candidate cluster is the arrival, note classification). The shipped demo resolves those judgments with a deterministic rule judge behind the same `ArrivalJudge` port. |
| Decisions made by AI | None. Visit status, exceptions, and reconciliation outcomes are deterministic rules. Models narrate, label, or resolve bounded ambiguities that a person reviews when confidence is low. |
| Training on Ring data | Never. No customer data is used to train or fine-tune any model. Any change to this answer is a material change requiring resubmission and 45 days' notice. |
| Explainability | Every judgment is logged with its inputs, options, and probabilities; every narrative carries a provenance label (model or template); every status shows the rule that produced it. |
| Safeguards | Bedrock Guardrails on generated text; a blocklist for health and identity language; output validators; template fallback; no identity inference of any kind. |
| Monitoring | Narrative validator failure rate, judgment confidence distribution, and human override rate are tracked in the reports view. |

## 4. Data Protection

| Question | Answer |
|---|---|
| Encryption | TLS 1.2+ in transit; DynamoDB and S3 encrypted at rest with KMS; Ring tokens envelope-encrypted with a dedicated KMS key; ledger records signed with a KMS asymmetric key. |
| Access controls | Cognito authentication; role-based authorization (agency admin, agency staff, family, caregiver) enforced in every server action and route handler; least-privilege IAM per Lambda; audit log of every access to evidence. |
| Webhook security | HMAC-SHA256 verification over raw bytes, constant-time comparison, idempotency on `request_id`, 401 on failure, no processing of unverified requests. |
| Secrets | No secrets in code or the browser; environment variables validated at startup; secret scanning in CI. |
| Vulnerability management | `pnpm audit` before releases; Dependabot; SECURITY.md disclosure process with a 3-business-day acknowledgement. |
| Incident response | Notify Ring per program requirements; notify affected agencies and families; rotate credentials; post-incident report. |
| Data residency | AWS us-east-1. |

## 5. Third Parties

| Party | Data shared | Purpose | Safeguards |
|---|---|---|---|
| Amazon Web Services | All stored data (as the cloud provider) | Hosting and processing | AWS shared responsibility; encryption; least privilege |
| Amazon Bedrock | Structured visit summaries (times, statuses); never media or names of residents | Narratives | Guardrails; no training on inputs per AWS terms |
| Amazon Rekognition | Cropped snapshot bytes when the family enables snapshots | Non-identifying labels | No face APIs used; images not retained by the service |
| TypeSafe (planned integration) | Candidate event metadata and caregiver note text | Bounded typed judgments | No media; no resident identifiers; server-side only |
| Agency EVV vendors and state aggregators | Alternate-EVV JSON exports initiated by the agency | Visit maintenance and claims support | Export only on agency action; signed; no media |

## 6. Reviewer Notes (Drafts for the Three Required Fields)

**Account creation.** Open the App Homepage URL, choose Create Account, enter an email, and confirm the one-time code. In the review environment, use the reviewer email listed in the submission; no password is required.

**Account linking.** From the Ring app, open the Ring Appstore, choose VisitProof, select the doorbell, and confirm. Ring posts the authorization code to our Token Exchange URL and redirects the browser to our Account Link page, where the Ring email is pre-filled; confirm the code to complete linking. The App Homepage then confirms success and opens Consent Settings.

**End-to-end test.** Use the Demo Studio at `/demo` (labeled Simulator) to run the `late_arrival` scenario. Within two minutes the agency Today board shows the visit as Late, an exception card opens, and the family feed shows the arrival time. Then run `no_show` and resolve the exception with a reason; export the Evidence Pack and verify it with the included verifier. Live-device paths (device check, history, snapshots, live view) run against the linked device.

## 7. Boundaries Stated to Customers

VisitProof is not an EVV system of record, not identity verification, not resident monitoring, and not a medical device. It never uses facial recognition, never correlates across Ring accounts, and works fully without any video access.
