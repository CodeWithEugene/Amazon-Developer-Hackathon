import { PolicyPage, type PolicySection } from "@/components/policy/prose"

export const metadata = { title: "Privacy Policy" }

const SECTIONS: readonly PolicySection[] = [
  {
    title: "What We Collect",
    paragraphs: [
      "VisitProof collects device metadata (name, online state, capabilities, and whether motion and privacy zones are set), event metadata (motion detected with its subtype, doorbell presses, and lifecycle and subscription events), event history for cameras and doorbells from the date you consent, optional snapshots from recordings at arrival when the family turns them on, and short live view sessions the family starts.",
    ],
  },
  {
    title: "What We Never Collect",
    items: [
      "No continuous video, no audio, and no clips.",
      "No facial or biometric data, and no identity inference of any kind.",
      "No interior cameras.",
      "No location beyond the coarse country and state the Ring API returns.",
    ],
  },
  {
    title: "Why We Use It",
    paragraphs: [
      "We use door events to confirm that a person arrived at and left the door inside a scheduled visit window, to raise exceptions to the agency, to produce a signed record, and to reconcile that record with EVV clock-ins.",
    ],
  },
  {
    title: "Consent",
    paragraphs: [
      "The Ring account holder chooses which devices to share in the Ring app. VisitProof then shows a plain consent screen: what is shared, with whom, whether snapshots are on, and how long they are kept. You can change or withdraw consent at any time in the Family Portal or in Ring My Apps. Turning off sharing hides visit details from the agency right away.",
    ],
  },
  {
    title: "Who Sees What",
    items: [
      "Family: everything about their own home.",
      "Agency staff: visit status, times, reconciliation, and snapshots only if the family opted in.",
      "Caregivers: door times and outcomes for their own visits, never snapshots.",
      "No one sees across accounts or across clients.",
    ],
  },
  {
    title: "Retention",
    items: [
      "Door events: 90 days (the agency can set 30 to 365 days).",
      "Snapshots: 7 days (the family can set 1 to 30 days).",
      "Signed evidence summaries: 7 years for compliance, without media.",
      "Raw webhook receipts: 30 days.",
    ],
  },
  {
    title: "Deletion",
    paragraphs: [
      "Delete Everything in the Family Portal removes the doorbell link, stops sharing, and deletes the door events, snapshots, and notes for the home. A signed record that a deletion happened is kept, with no personal data in it. Removing VisitProof in Ring My Apps starts the same deletion.",
    ],
  },
  {
    title: "AI And Models",
    paragraphs: [
      "Visit status, exceptions, and reconciliation outcomes are deterministic rules. Models only write plain-language narratives or settle a bounded question that a person reviews when confidence is low. No customer data is ever used to train or fine-tune a model, and every narrative carries a label saying whether a template or a model wrote it.",
    ],
  },
  {
    title: "Security",
    paragraphs: [
      "Data is encrypted in transit with TLS 1.2 or later and at rest with AWS KMS. Ring tokens are envelope encrypted with a dedicated key. Webhooks are verified with HMAC SHA-256 before anything is processed. We never sell data, never use it for advertising, and never build profiles.",
    ],
  },
  {
    title: "Contact",
    paragraphs: ["Technetium Kenya, maker of VisitProof: eugenegabriel.ke@gmail.com."],
  },
]

export default function PrivacyPage() {
  return (
    <PolicyPage
      title="Privacy Policy"
      lead="VisitProof corroborates home-care visits from door events. It never watches the resident and never identifies who is at the door."
      sections={SECTIONS}
    />
  )
}
