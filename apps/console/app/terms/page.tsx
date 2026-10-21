import { PolicyPage, type PolicySection } from "@/components/policy/prose"

export const metadata = { title: "Terms Of Use" }

const SECTIONS: readonly PolicySection[] = [
  {
    title: "What VisitProof Is",
    paragraphs: [
      "VisitProof matches doorbell presses and person motion at a client's door to the agency's visit schedule and the caregiver's own EVV clock-in, then produces a signed record with three separate columns: Observed, Reported, and Resolved.",
    ],
  },
  {
    title: "What VisitProof Is Not",
    items: [
      "Not an EVV system of record. The agency's EVV vendor and the state aggregator remain authoritative.",
      "Not identity verification. VisitProof shows that a person arrived at the door. It never identifies who.",
      "Not resident monitoring and not a medical device.",
      "It never uses facial recognition, never correlates across Ring accounts, and works fully without video.",
    ],
  },
  {
    title: "Your Responsibilities",
    items: [
      "Agencies use the record to support, not replace, their own EVV and billing review.",
      "Families link only doorbells they are authorized to share, and can pause or delete at any time.",
      "Caregivers use notes and disputes to add their side of the record honestly.",
    ],
  },
  {
    title: "Plans",
    paragraphs: [
      "The family plan is offered through the Ring Appstore. The agency plan is billed to the agency outside Ring. Demo accounts in this build use local demo data only.",
    ],
  },
  {
    title: "Changes",
    paragraphs: [
      "We give 45 days notice before any material change to how data is processed, and we never begin training models on customer data.",
    ],
  },
  {
    title: "Contact",
    paragraphs: ["Technetium Kenya, maker of VisitProof: eugenegabriel.ke@gmail.com."],
  },
]

export default function TermsPage() {
  return (
    <PolicyPage
      title="Terms Of Use"
      lead="Plain terms for agencies, families, and caregivers using VisitProof."
      sections={SECTIONS}
    />
  )
}
