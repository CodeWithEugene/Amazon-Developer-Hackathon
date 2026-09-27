---
inclusion: always
---
# VisitProof Product Steering

VisitProof turns Ring doorbell and camera events at a home-care client's door into proof of presence for scheduled caregiver visits. Users: agency schedulers and compliance leads (primary), families (consent holders), caregivers (fair record).

Principles that every change must honor:
- Corroboration, not surveillance. The record says a person arrived at the door at a time; it never says who and never monitors the resident.
- Events first, pixels optional. Every feature works with zero video access; snapshots are family-controlled enrichments with expiry.
- Three columns, never merged: observed (door), reported (caregiver), resolved (agency). Each signed.
- Silence is signed: unobservable windows carry a reason.
- Deterministic decisions; AI narrates or resolves bounded ambiguities only.
- One message a day for families; exceptions interrupt.
- Not an EVV system of record, not identity verification, not a medical device.

Read docs/solution.md for intent and docs/build.md for the engineering contract before proposing changes.
