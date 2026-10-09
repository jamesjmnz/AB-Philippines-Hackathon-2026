import { projectionField, projectionReportText, type SentProjection } from '@/crypto/capsule';
import {
  CLAIM_FIELDS,
  levelForDevice,
  normalizeValue,
  projectForLevel,
  type Actor,
  type ClaimField,
  type DisclosureLevel,
  type DisclosurePolicy,
  type IncidentProjection,
  type IncidentState,
} from '@/domain';

import type { FactView, IncidentView, RecipientPolicyInput } from './api';

/** Short human reference derived from the incident id. Carries no personal data. */
export function shortIdFor(incidentId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < incidentId.length; i += 1) {
    h ^= incidentId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `PULSE-${((h >>> 0) & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
}

export type NameOf = (actor: Actor) => string;

/** Facts for the reporter's own device: everything, with who said it and the words backing it. */
export function ownerFacts(state: IncidentState, nameOf: NameOf): FactView[] {
  return CLAIM_FIELDS.map((field) => {
    const claim = state.claims[field];
    const displayed = claim.revisions.find((r) => r.id === claim.displayedRevisionId) ?? null;
    const confirmed =
      displayed?.confirmsRevisionId != null ? (claim.revisions.find((r) => r.id === displayed.confirmsRevisionId) ?? null) : null;
    const evidence = displayed?.evidence?.text ?? confirmed?.evidence?.text ?? null;
    const openIds = new Set(
      state.contradictions.filter((c) => c.field === field && c.status === 'open').flatMap((c) => c.revisionIds),
    );
    const seen = new Set<string>();
    const candidates: { value: string; by: string }[] = [];
    for (const r of claim.revisions) {
      if (!openIds.has(r.id)) continue;
      const key = normalizeValue(r.value);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ value: r.value, by: nameOf(r.source.actor) });
    }
    return {
      field,
      value: claim.value,
      tag: claim.tag,
      by: displayed ? nameOf(displayed.source.actor) : null,
      evidence: evidence && evidence.length > 0 ? evidence : null,
      protected: false,
      candidates,
    };
  });
}

function whoSaid(state: IncidentState, field: ClaimField, value: string | null, nameOf: NameOf): string | null {
  if (value === null) return null;
  const key = normalizeValue(value);
  const revisions = state.claims[field].revisions;
  for (let i = revisions.length - 1; i >= 0; i -= 1) {
    const r = revisions[i];
    if (r && r.source.kind !== 'ai_proposal' && normalizeValue(r.value) === key) return nameOf(r.source.actor);
  }
  return null;
}

/**
 * Facts as one disclosure level reads them. A field the projection does not contain is marked
 * `protected`: the value is not on this device at all, it was never decrypted.
 */
export function projectionFacts(projection: SentProjection | IncidentProjection, local: IncidentState, nameOf: NameOf): FactView[] {
  return CLAIM_FIELDS.map((field) => {
    const p = projectionField(projection, field);
    if (!p) {
      return { field, value: null, tag: 'unknown', by: null, evidence: null, protected: true, candidates: [] };
    }
    return {
      field,
      value: p.value,
      tag: p.tag,
      by: whoSaid(local, field, p.value, nameOf),
      evidence: null,
      protected: false,
      candidates: p.candidates.map((value) => ({ value, by: whoSaid(local, field, value, nameOf) ?? '' })),
    };
  });
}

export function policyFromInput(
  input: RecipientPolicyInput,
  nameFor: (deviceId: string) => string | null,
  isLocal: (deviceId: string) => boolean,
): DisclosurePolicy {
  const recipients: DisclosurePolicy['recipients'] = [];
  for (const [deviceId, level] of Object.entries(input.levels)) {
    if (level === 'off' || isLocal(deviceId)) continue;
    const userName = nameFor(deviceId);
    recipients.push({ deviceId, level, ...(userName ? { userName } : {}) });
  }
  return {
    shareDetailedLocation: input.shareDetailedLocation,
    shareSymptoms: input.shareSymptoms,
    recipients: recipients.slice(0, 32),
  };
}

export interface IncidentViewInput {
  state: IncidentState;
  selfId: string | null;
  isLocal: (deviceId: string) => boolean;
  nameOf: NameOf;
  /** The reporter's latest projection for this device's level, if one has arrived. */
  stored: SentProjection | null;
  viaName: string | null;
  pendingOutbox: number;
}

/** Null when this device may not list the incident (unknown incident, or relay-only access). */
export function buildIncidentView(input: IncidentViewInput): IncidentView | null {
  const { state, selfId, isLocal, nameOf } = input;
  if (!state.incident) return null;
  const base = {
    id: state.incidentId,
    shortId: shortIdFor(state.incidentId),
    state,
    receivedViaName: input.viaName,
    pendingOutbox: input.pendingOutbox,
  };
  if (isLocal(state.incident.reporter.deviceId)) {
    const own = state.reports.filter((r) => r.kind === 'report' && r.role === 'reporter').map((r) => r.text);
    return {
      ...base,
      role: 'reporter',
      access: 'owner',
      facts: ownerFacts(state, nameOf),
      originalReport: own.length > 0 ? own.join('\n') : null,
      receivedViaName: null,
    };
  }
  if (selfId === null) return null;
  const level = levelForDevice(state, selfId);
  if (level === 'owner' || level === 'relay') return null;
  const access: DisclosureLevel = level;
  // The stored projection is what the reporter sealed for this level. Without one (nothing but
  // bare events has arrived yet) the same deterministic projection is applied to what is held locally.
  const usable = input.stored && (input.stored.level === access || input.stored.level === 'trusted') ? input.stored : null;
  const projection: SentProjection | IncidentProjection = usable ?? projectForLevel(state, access);
  return {
    ...base,
    role: 'responder',
    access,
    facts: projectionFacts(projection, state, nameOf),
    originalReport: projectionReportText(projection),
  };
}
