# The Problem VisitProof Solves

> A precise statement of the customer problem, who has it, how big it is, what exists today, and why a Ring doorbell is the right instrument. This is the "Potential Impact" case in the judges' language and the "why" behind [solution.md](./solution.md).

---

## 1. The Scene (What Happens Every Morning in a Home-Care Agency)

It is 6:10 AM. A scheduler at a 60-client home-care agency is working two phones. A caregiver was due at Mrs. Okoro's house at 6:00 for a two-hour personal-care visit. The caregiver's mobile EVV app shows no clock-in. Is she late? Is she at the door but her phone has no signal? Did she skip the shift? The scheduler will not know for another twenty to forty minutes, and by then the backfill pool is gone.

Two weeks later the same visit resurfaces as a **denied Medicaid claim**: the state aggregator found no verified visit record matching the billed service. The agency now spends coordinator time on "visit maintenance" (reason codes, manual attestations, resubmission) and waits weeks for cash that was already spent on wages.

Meanwhile, Mrs. Okoro's daughter in another city texts the agency for the third time this month: "Did anyone actually come today?"

Three people share one blind spot: **nobody has an independent, timestamped, location-bound signal of when a person arrived at and left the client's door.**

---

## 2. Who Has the Problem

| Persona | Role | Pain today | What they need |
|---|---|---|---|
| **Agency scheduler / care coordinator** ("Dana") | Runs the daily schedule for 40 to 120 clients; first to know about call-outs; owns backfilling | Learns about no-shows late; relies on caregiver clock-ins that are missing, late, or GPS-drifted; phones families to confirm | A real-time signal at the client's door: arrived, late, no-show, left early; one screen to act from |
| **Agency compliance / billing lead** ("Marcus") | Reconciles visits to EVV records and submits claims; answers audits | Hard-edit denials in 2026; manual visit maintenance; no corroborating evidence when GPS fails; audit exposure | Corroboration for every EVV exception; exportable, tamper-evident evidence in the shape the aggregator and auditor expect |
| **Family member** ("Priya", adult daughter) | Pays privately or manages a Medicaid-funded plan for a parent; lives elsewhere | Cannot tell whether the visit happened, when, or for how long; calls the agency; erodes trust | A calm daily feed: "Caregiver arrived 6:04, left 8:02" with an optional doorbell snapshot; alerts only when something is wrong |
| **Caregiver** ("Luis") | Works 3 to 6 visits a day, often in low-signal areas; blamed when the clock-in fails | Unpaid visits, disputes, suspicion | A fair, independent record that proves he was there when his phone was not |
| **Care recipient** ("Mrs. Okoro") | Owns the Ring doorbell (or her family does) | Wants care to arrive; does not want to be watched | Consent-native: events about the door, never surveillance of her; withdrawable at any time |

---

## 3. How Big It Is

- US home care is a $113 to $174 billion industry with 33,000 to 35,000 agencies and 3.5 million workers; Medicaid pays about 28% of revenue, Medicare 38%.
- **Every Medicaid-funded personal-care and home-health visit must be electronically verified** (21st Century Cures Act, Section 12006) with six data elements: service type, recipient, provider, date, location, start and end time.
- **2026 is the enforcement year.** States are switching from soft edits to hard edits that automatically deny claims without a matching verified visit: Missouri (1 April 2026), Minnesota (January), Ohio (spring), Indiana and Pennsylvania (later in 2026), Massachusetts (not before July 2026). Compliance floors are 85 to 90%.
- **GPS clock-ins are the weak link.** One proof-of-presence vendor reports a 56% GPS match rate for GPS-based EVV; caregivers openly share GPS-spoofing workarounds; rural coverage gaps and "GPS drift" are the most common vendor complaints; fixed visit verification devices exist precisely because phones are unreliable.
- **Operational cost.** Missed visits, late clock-ins, and 6 AM backfills are named top pain points in 2026 agency surveys; caregiver turnover runs 75 to 77% a year, so schedules churn constantly.
- **Family trust.** Agency software vendors describe families "left in the dark about their loved one's daily care," which "quietly erodes the trust the entire business depends on." No-shows and late arrivals are the number one family complaint.
- **Installed base.** Ring is the most common video doorbell in US homes, and the Ring Appstore (launched March 2026) lists elder-care monitoring as a headline category. The doorbell is already at the door, owned by the family, and produces server-signed, timestamped events.

A single denied personal-care claim is worth $80 to $150; one client with a week of denials exceeds a year of the subscription VisitProof will charge for that client.

---

## 4. What Exists Today and Why It Falls Short

| Existing approach | What it does | Where it fails |
|---|---|---|
| GPS mobile EVV (Sandata, HHAeXchange, AxisCare, and dozens more) | Caregiver clocks in on a phone; GPS and timestamp are captured | Depends on the caregiver's device, signal, honesty, and battery; drifts; spoofable; no independent corroboration |
| Telephony (IVR) EVV | Caregiver calls from the client's landline | Landlines are disappearing; caller-ID spoofing; nothing about departure or duration |
| Fixed visit verification fobs | A device in the home generates time-bound codes | Extra hardware per client; codes are transcribed by hand; no real-time alerting; nothing for families |
| Family monitoring apps on Ring (Density Routines, Beside Care, StillThere, Nightlight, Ring Med Watch) | Detect routine changes, falls, night wandering, inactivity | Built for the adult child, not the agency; no schedule, no clock-in reconciliation, no claims, no exports |
| Household visit records on Ring (Attest, CareDoor) | Match arrivals to expected visits; sign what was observed | Household-facing; Attest explicitly disclaims EVV; no agency workflow, no reliability analytics, no aggregator export |
| Agency management platforms | Scheduling, billing, EVV submission | No independent physical-presence signal at all; they can only report what the phone said |

The gap is not "another alert." It is **an independent proof-of-presence signal at the client's door, joined to the agency's schedule and the caregiver's own clock-in, delivered in real time to the person who can act, and exported in the shape a payer and an auditor accept.**

---

## 5. Why a Ring Doorbell Is the Right Instrument

1. **Already installed and already consented.** The family owns the device, decides which devices to share, and can withdraw access in Ring My Apps at any time. VisitProof never installs hardware and never asks the caregiver to carry anything.
2. **Independent of the caregiver's phone.** Doorbell presses and human-motion events are generated by the device, signed by Ring's servers (HMAC-SHA256), timestamped, and delivered to VisitProof's backend. A caregiver cannot spoof them from a phone, and a dead battery in a pocket does not erase them.
3. **Observes exactly what EVV needs.** Arrival and departure at the location of service. VisitProof adds the schedule (service type, recipient, provider, authorized units) and the caregiver's self-report, producing all six EVV data elements with an independent corroboration column.
4. **Works on events alone.** Ring's TAKE encryption is becoming the default; VisitProof's core never needs pixels. When a snapshot is available and the family allows it, it is an enrichment for the family feed and for evidence packs, never a requirement.
5. **Never identifies anyone.** Facial recognition is prohibited on the Ring Appstore and unnecessary here. VisitProof's claim is deliberately bounded: a person arrived at and left the door inside the scheduled window, corroborated by the caregiver's clock-in. That bounded claim is precisely the corroboration agencies lack.

---

## 6. What "Solved" Looks Like (Success Criteria)

- **Time to know:** the scheduler knows about a late arrival within 15 minutes of the scheduled start, not 40. (Configurable grace window; default 15 minutes.)
- **Reconciliation coverage:** every EVV exception (missing, late, or short clock-in) has a doorbell corroboration status: corroborated, contradicted, or unobservable (device offline, out of zone, encrypted), with the reason.
- **Claims outcome:** agencies can attach a signed VisitProof evidence record to a visit before submission or during visit maintenance, and export the alternate-EVV JSON shape for their aggregator workflow.
- **Family trust:** a daily, calm, one-message-per-day feed with arrival and departure times; alerts only on exceptions; opt-out and deletion in two taps.
- **Caregiver fairness:** every caregiver can see the door record for their own visits and add a note; observations, self-reports, and agency resolutions are stored in separate columns and never merged.
- **Privacy floor:** event metadata first; snapshots optional, family-controlled, auto-expiring; no identity inference; no cross-account correlation; deletion on request.

---

## 7. Explicit Boundaries (What VisitProof Is Not)

- Not an EVV system of record and not a certified alternate-EVV vendor. It corroborates and exports; the agency's EVV vendor and the state aggregator remain the system of record.
- Not surveillance of the care recipient. It reads door events, not the home. No routine learning about the resident, no inactivity alerts.
- Not identity verification. It never says who came; it says a person came, when, and for how long, and lets the caregiver's clock-in and the agency's schedule supply the who.
- Not a medical device and not clinical decision support. It contains no clinical claims.
- Not dependent on Ring video. It degrades gracefully when media is encrypted or unavailable.

---

## 8. One-Sentence Problem Statement

Home-care agencies, families, and caregivers all lose money, time, and trust because nobody has an independent record of when a person arrived at and left the client's door; VisitProof turns the Ring doorbell that is already there into that record.
