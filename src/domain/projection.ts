import type { Claim, ClaimField, ProvenanceTag } from './claims';
import { canReadItem, levelInPolicy, type AccessLevel, type DisclosurePolicy } from './disclosure';
import type { TaskKind } from './events';
import type { IncidentState, IncidentStatusInfo, TaskStatus } from './state';

/**
 * Deterministic access projection: what a given level may read. Fields a level may not read are
 * absent from the result (the key does not exist), not blanked. The capsule encryptor builds each
 * ciphertext from one of these projections, so nothing outside it can leak into that ciphertext.
 */

/** Routing metadata only: identifiers, no names and no content. */
export interface RoutingMetadata {
  incidentId: string;
  reporterDeviceId: string | null;
  recipientDeviceIds: string[];
}

/** A field as displayed, without revision history or evidence text. */
export interface ProjectedField {
  value: string | null;
  tag: ProvenanceTag;
  candidates: string[];
}

export interface ProjectedTask {
  id: string;
  kind: TaskKind;
  title: string;
  inPerson: boolean;
  status: TaskStatus;
  offeredToDeviceId: string | null;
  assigneeDeviceId: string | null;
  assigneeName: string | null;
}

export interface ProjectedReport {
  id: string;
  kind: 'report' | 'observation';
  authorName: string;
  text: string;
}

export type SummaryField = Exclude<ClaimField, 'symptom'>;

export interface SummaryProjection {
  reporterName: string | null;
  status: IncidentStatusInfo;
  /** Only the fields this level may read are present. */
  fields: Partial<Record<SummaryField, ProjectedField>>;
  /** Fields with an open contradiction, limited to fields this level may read. */
  unresolvedFields: SummaryField[];
  tasks: ProjectedTask[];
}

export interface RestrictedDetail {
  symptom: ProjectedField;
  reports: ProjectedReport[];
}

export type IncidentProjection =
  | { level: 'relay'; routing: RoutingMetadata }
  | { level: 'trusted'; routing: RoutingMetadata; summary: SummaryProjection }
  | { level: 'authorized'; routing: RoutingMetadata; summary: SummaryProjection; detail?: RestrictedDetail }
  | { level: 'owner'; routing: RoutingMetadata; state: IncidentState };

const SUMMARY_FIELDS: readonly SummaryField[] = [
  'incidentType',
  'building',
  'assistanceRequested',
  'floor',
  'locationText',
];

function projectField(claim: Claim): ProjectedField {
  return { value: claim.value, tag: claim.tag, candidates: [...claim.candidates] };
}

function routingOf(state: IncidentState): RoutingMetadata {
  return {
    incidentId: state.incidentId,
    reporterDeviceId: state.incident?.reporter.deviceId ?? null,
    recipientDeviceIds: state.recipients.map((r) => r.deviceId),
  };
}

function summaryOf(state: IncidentState, level: AccessLevel, policy: DisclosurePolicy): SummaryProjection {
  const fields: Partial<Record<SummaryField, ProjectedField>> = {};
  const unresolvedFields: SummaryField[] = [];
  for (const field of SUMMARY_FIELDS) {
    if (!canReadItem(level, field, policy)) continue;
    const claim = state.claims[field];
    fields[field] = projectField(claim);
    if (claim.tag === 'unresolved') unresolvedFields.push(field);
  }
  return {
    reporterName: state.incident?.reporter.userName ?? null,
    status: { ...state.status },
    fields,
    unresolvedFields,
    tasks: state.tasks.map((t) => ({
      id: t.id,
      kind: t.kind,
      title: t.title,
      inPerson: t.inPerson,
      status: t.status,
      offeredToDeviceId: t.offeredToDeviceId,
      assigneeDeviceId: t.assignee?.deviceId ?? null,
      assigneeName: t.assignee?.userName ?? null,
    })),
  };
}

export function projectForLevel(
  state: IncidentState,
  level: AccessLevel,
  policy: DisclosurePolicy = state.disclosure,
): IncidentProjection {
  const routing = routingOf(state);
  if (level === 'owner') return { level, routing, state };
  if (level === 'relay') return { level, routing };
  const summary = summaryOf(state, level, policy);
  if (level === 'trusted') return { level, routing, summary };
  if (!canReadItem(level, 'symptom', policy)) return { level, routing, summary };
  return {
    level,
    routing,
    summary,
    detail: {
      symptom: projectField(state.claims.symptom),
      reports: canReadItem(level, 'originalReport', policy)
        ? state.reports.map((r) => ({ id: r.id, kind: r.kind, authorName: r.author.userName, text: r.text }))
        : [],
    },
  };
}

/** The level a device holds for this incident: the reporter is the owner, everyone unlisted is a relay. */
export function levelForDevice(state: IncidentState, deviceId: string): AccessLevel {
  if (state.incident?.reporter.deviceId === deviceId) return 'owner';
  return levelInPolicy(state.disclosure, deviceId);
}

export function projectForDevice(state: IncidentState, deviceId: string): IncidentProjection {
  return projectForLevel(state, levelForDevice(state, deviceId));
}
