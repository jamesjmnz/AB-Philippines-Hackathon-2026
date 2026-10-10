# Product requirements

Status: requirements document. As of 2026-10-10 the code for these requirements is written and unit-tested, and none of it has been verified on a physical iPhone. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for what exists and what is unverified.

## What PULSE is

PULSE 2.0 is a prototype of assistance coordination between nearby iPhones that works without an internet connection. A person presses SOS, optionally describes what happened, and trusted nearby people can acknowledge, volunteer for specific non-medical tasks and add their own observations.

PULSE is **not** an emergency service, a medical device, a certified fall detector, a background guardian or a guaranteed rescue channel. It reaches only participating iPhones that are connected at that moment.

## Problem

When connectivity is poor or absent, a person who needs help has no structured way to tell nearby trusted people what is happening, and those people have no shared, trustworthy record of who knows what and who has agreed to do what. Chat messages blur "sent", "seen", "agreed" and "done". Reports made under stress are incomplete and sometimes contradict each other.

## Two differentiating capabilities

| Capability | What it does |
| --- | --- |
| **CareChain** | Evidence-attributed incident handoff. Keeps the original report, AI proposals, clarifications, contradictions, voluntary non-medical tasks and response events as separate, attributed entries. Unknowns stay unknown. Corrections never erase earlier statements. |
| **Rescue Capsules** | Privacy-controlled offline sharing. Incident content is encrypted per recipient. Relay-only peers forward ciphertext they cannot read. Delivery is shown only after an authenticated receipt. Undelivered capsules are stored and retried when a peer is reachable. |

## Personas

All personas are synthetic and exist for demonstration only. No real person or real incident is represented.

| Persona | Demo device | Role |
| --- | --- | --- |
| Alex Rivera | iPhone 17 Pro Max | Reporter. The only device expected to run the on-device text model. |
| Mika Santos | iPhone 14 Pro Max | Trusted responder and relay. Offers a communication task (for example contacting staff). |
| Noah Cruz | iPhone 13 | Trusted responder. Accepts an in-person task (for example meeting the requester). |

The design export also contains background personas (Sofia Reyes, Daniel Lim, "Jordan's iPhone" as a relay-only peer). They will appear only in Demo Lab.

## Scope

- Manual SOS that persists and queues immediately, with no dependency on AI, microphone, transport or any permission.
- Optional typed or spoken report, kept verbatim as human-authored evidence.
- Local AI on eligible hardware: structured extraction with evidence spans, at most one optional clarification question, contradiction notes, non-medical task proposals. All AI output is a proposal.
- Deterministic conflict detection for explicit fields (for example floor), so conflicts are found without a model.
- CareChain coordination: acknowledge, decline, offer a task, accept a task, report progress, report completion, confirm completion, resolve, cancel.
- Trusted-peer pairing with a short code compared by both people.
- Rescue Capsules: per-recipient encryption, three disclosure levels, authenticated receipts, store-and-forward with a hop limit.
- Demo Lab: scripted, isolated, visibly labelled SIMULATED.
- iOS only. Three physical iPhones for verification.

## Non-goals

- Dispatching public emergency services, or implying that anyone has been dispatched.
- Diagnosis, injury severity, triage priority or any medical instruction.
- Camera or computer-vision features.
- Background or suspended-app operation. The first demonstration is foreground only.
- Universal mesh networking. Relay is an explicit app-level mechanism with a hop limit and is claimed only if tested.
- Cloud inference, cloud sync or account login in the live path.
- Android.
- App Store release.

## Core flows

1. **Immediate SOS.** Tap SOS, confirm. The incident and its outbound queue entry are written in one local transaction. The UI shows "Saved and queued" until a receipt exists.
2. **Add a report.** Type or dictate. The original words are stored unchanged.
3. **Local AI interpretation (eligible device only).** Extraction proposes fields, each backed by a verbatim span of the report. Fields without a span become `unknown`. One optional clarification question may be offered.
4. **Capsule.** The reporter reviews recipients and disclosure levels, then the capsule is encrypted and queued.
5. **Delivery.** Transport sends ciphertext. The receiving device persists and validates it, then returns a signed receipt. Only then does the sender show "Delivered".
6. **Human response.** A responder acknowledges (a human action), may decline, may offer or accept a specific task, reports progress and completion.
7. **Contradiction.** A responder reports a different floor. Both claims are kept with source and time. The conflict is flagged. An authorized human resolves it.
8. **Resolution.** An authorized human explicitly resolves or cancels the incident.

## States that must stay distinct

`QUEUED`, `DELIVERED`, `ACKNOWLEDGED`, `ACCEPTED`, `ARRIVAL REPORTED`, `RESOLVED`. A sent packet is not a delivery. A delivery is not a human acknowledgment. An acknowledgment is not an accepted task. Acceptance is not arrival. Reported completion is not confirmed completion.

## Acceptance

The product is accepted against the phase gates in [PHASE_PLAN.md](PHASE_PLAN.md). In summary:

| Area | Accepted when |
| --- | --- |
| SOS independence | Manual SOS persists and queues with AI, microphone and transport all unavailable. |
| Local AI | A new, unseen report is interpreted on the iPhone 17 Pro Max with external internet disabled, and unavailable, refusal and unsupported-locale cases are handled. |
| Transport | A packet and its receipt cross between two physical iPhones with external internet disabled. |
| Privacy | A relay-only peer cannot read content; a trusted recipient reads exactly what was approved. |
| CareChain | The two-phone integrated flow runs end to end. Three-phone relay is a separate gate. |
| Truthfulness | No screen, document or demo claims a state that was not measured. |

Hackathon scoring context: 25% usefulness, 25% genuine Local AI, 20% technical execution, 15% innovation, 15% product and demo quality.
