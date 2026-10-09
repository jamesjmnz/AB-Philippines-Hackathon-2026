import type { AIState, CapabilityMatrix, ProposalField } from '@/ai';
import type {
  ClaimField,
  DeliveryState,
  DisclosureLevel,
  EventType,
  IncidentState,
  ProvenanceTag,
  TaskStatus,
} from '@/domain';
import type { DiscoveryState, IncidentView, PeerView, PulseSnapshot } from '@/services/api';
import type { IconName, Step, Tone } from '@/ui';

/**
 * Pure presentation rules. Every user-facing status word in the app comes from here, and each one is
 * derived from ledger state only: a queued request is never called sent, a send attempt is never
 * called delivered, seen is never called accepted, and arrival is never implied.
 */

export type Me = { deviceId: string };

export function displayName(me: Me, deviceId: string, userName: string): string {
  return deviceId === me.deviceId ? 'You' : userName;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * `ring` is the design's status colour (map-card dot, step bar) and `icon` its Activity glyph
 * (design `st()`, line 1041): coral while nobody has the request, amber while it waits to be taken,
 * green once a role is held, grey when cancelled.
 */
export type StatusPresentation = { title: string; chip: string; tone: Tone; sub: string; ring: string; icon: IconName };

const RING = { coral: '#ED625E', amber: '#F4B860', green: '#27A878', gray: '#C7C7CC' } as const;

function statusWords(state: IncidentState, me: Me): { title: string; chip: string; sub: string } & { tone: Tone } {
  const reporterId = state.incident?.reporter.deviceId ?? null;
  const held = state.tasks.filter((t) => t.assignee !== null && t.assignee.deviceId !== reporterId);
  const who = (deviceId: string, userName: string) => displayName(me, deviceId, firstName(userName));

  switch (state.status.status) {
    case 'cancelled':
      return {
        title: 'Cancelled',
        chip: 'Cancelled',
        tone: 'gray',
        sub: state.closure ? `Cancelled by ${who(state.closure.by.deviceId, state.closure.by.userName)}. No further action is requested.` : 'This request was cancelled.',
      };
    case 'resolved':
      return {
        title: 'Resolved',
        chip: 'Resolved',
        tone: 'green',
        sub: state.closure ? `Marked resolved by ${who(state.closure.by.deviceId, state.closure.by.userName)}.` : 'Marked resolved.',
      };
    case 'in_progress': {
      const task = held.find((t) => t.inPerson && t.status === 'in_progress');
      const name = task?.assignee ? who(task.assignee.deviceId, task.assignee.userName) : 'A responder';
      return {
        title: name === 'You' ? 'You are on the way' : `${name} is on the way`,
        chip: 'In progress',
        tone: 'green',
        sub: 'Arrival is not confirmed. This is what the responder reported.',
      };
    }
    case 'role_taken': {
      const names = [...new Set(held.map((t) => (t.assignee ? who(t.assignee.deviceId, t.assignee.userName) : '')))].filter(Boolean);
      const reported = held.find((t) => t.status === 'completion_reported');
      const confirmed = held.length > 0 && held.every((t) => t.status === 'completion_confirmed');
      const subject = joinNames(names) || 'A responder';
      let sub = 'A role was accepted. Nobody has reported being on the way.';
      if (confirmed) sub = 'Completion confirmed by the requester. The request stays open until it is resolved.';
      else if (reported) sub = 'Completion was reported and is waiting for the requester to confirm.';
      return { title: `${subject} took a role`, chip: 'Role taken', tone: 'green', sub };
    }
    case 'acknowledged': {
      const names = state.recipients.filter((r) => r.acknowledged).map((r) => who(r.deviceId, r.userName));
      return {
        title: `Seen by ${joinNames(names) || 'a responder'}`,
        chip: 'Seen',
        tone: 'green',
        sub: 'Seen is not the same as accepting. Nobody has taken a role yet.',
      };
    }
    case 'delivered':
      return {
        title: 'Delivered · not yet seen',
        chip: 'Delivered',
        tone: 'green',
        sub: 'A trusted device confirmed receipt. Nobody has marked it as seen yet.',
      };
    case 'queued':
      if (reporterId !== null && reporterId !== me.deviceId) {
        // A responder's copy: it is on this device, and the requester may not have the receipt yet.
        return {
          title: 'Received on this device',
          chip: 'Received',
          tone: 'amber',
          sub: 'This request reached your device. The requester sees it as delivered only when your receipt gets back to them.',
        };
      }
      if (state.status.reason === 'no_trusted_peer') {
        return {
          title: 'Saved on this device',
          chip: 'Not delivered',
          tone: 'amber',
          sub: 'No trusted device paired. Nobody has received this request. Pair a device in Network.',
        };
      }
      if (state.status.reason === 'send_attempted_no_receipt') {
        return {
          title: 'Sending…',
          chip: 'Not delivered yet',
          tone: 'amber',
          sub: 'A send was attempted. No delivery receipt has come back yet.',
        };
      }
      return {
        title: 'Saved on this device',
        chip: 'Queued',
        tone: 'amber',
        sub: 'Saved on this device · waiting for a trusted device. Nobody has received it yet.',
      };
  }
}

/** Status wording (above) plus the design's colour and glyph for that state. */
export function presentStatus(state: IncidentState, me: Me): StatusPresentation {
  const words = statusWords(state, me);
  const reporterId = state.incident?.reporter.deviceId ?? null;
  switch (state.status.status) {
    case 'cancelled':
      return { ...words, tone: 'gray', ring: RING.gray, icon: 'block' };
    case 'resolved':
      return { ...words, tone: 'green', ring: RING.green, icon: 'verified' };
    case 'in_progress':
    case 'role_taken':
      return { ...words, tone: 'green', ring: RING.green, icon: 'volunteer_activism' };
    case 'acknowledged':
      return { ...words, tone: 'amber', ring: RING.amber, icon: 'visibility' };
    case 'delivered':
      return { ...words, tone: 'amber', ring: RING.amber, icon: 'hourglass_top' };
    case 'queued':
      // A responder's own copy is waiting on them (amber); the requester's unsent request is the urgent one.
      return reporterId !== null && reporterId !== me.deviceId
        ? { ...words, tone: 'amber', ring: RING.amber, icon: 'hourglass_top' }
        : { ...words, tone: 'coral', ring: RING.coral, icon: 'emergency' };
  }
}

export const STEP_LABELS = ['Saved', 'Delivered', 'Seen', 'Role taken', 'Resolved'] as const;

/** Each step is filled only by its own evidence, never because a later or earlier one is. */
export function presentSteps(state: IncidentState): Step[] {
  const reporterId = state.incident?.reporter.deviceId ?? null;
  const done = [
    state.incident !== null,
    state.recipients.some((r) => r.delivery === 'delivered'),
    state.recipients.some((r) => r.acknowledged),
    state.tasks.some((t) => t.assignee !== null && t.assignee.deviceId !== reporterId && t.status !== 'unassigned' && t.status !== 'offered'),
    state.closure?.kind === 'resolved',
  ];
  return STEP_LABELS.map((label, i) => ({ label, done: done[i] === true }));
}

export function isOpen(view: IncidentView): boolean {
  return view.state.closure === null;
}

export const PROVENANCE: Record<ProvenanceTag, { label: string; tone: Tone; solid?: boolean }> = {
  user_reported: { label: 'user reported', tone: 'neutral' },
  ai_proposed: { label: 'AI proposed', tone: 'indigo' },
  user_confirmed: { label: 'user confirmed', tone: 'green', solid: true },
  responder_reported: { label: 'responder reported', tone: 'gray' },
  unresolved: { label: 'unresolved', tone: 'amber' },
  unknown: { label: 'unknown', tone: 'gray' },
};

export const FIELD_LABELS: Record<ClaimField | ProposalField, string> = {
  incidentType: 'Request type',
  building: 'Building',
  floor: 'Floor',
  locationText: 'Location, as described',
  symptom: 'What was described',
  assistanceRequested: 'Assistance requested',
};

export const LEVEL_LABELS: Record<DisclosureLevel | 'off' | 'owner', string> = {
  off: 'Off',
  relay: 'Passes along',
  trusted: 'Can see summary',
  authorized: 'Can see everything',
  owner: 'Requester',
};

export const LEVEL_SHORT: Record<DisclosureLevel | 'off', string> = {
  off: 'Off',
  relay: 'Passes along',
  trusted: 'Summary',
  authorized: 'Everything',
};

export function presentDelivery(delivery: DeliveryState): { label: string; tone: Tone } {
  switch (delivery) {
    case 'delivered':
      return { label: 'Delivered', tone: 'green' };
    case 'send_attempted':
      return { label: 'Not delivered yet', tone: 'amber' };
    case 'queued':
      return { label: 'Queued', tone: 'amber' };
    case 'none':
      return { label: 'Not prepared', tone: 'gray' };
  }
}

export const TASK_STATUS: Record<TaskStatus, { label: string; tone: Tone; solid?: boolean }> = {
  unassigned: { label: 'Open', tone: 'gray' },
  offered: { label: 'Open', tone: 'gray' },
  accepted: { label: 'Taken', tone: 'green' },
  in_progress: { label: 'In progress', tone: 'green' },
  completion_reported: { label: 'Reported done', tone: 'amber' },
  completion_confirmed: { label: 'Confirmed', tone: 'green', solid: true },
};

type EventLook = { label: string; icon: IconName; tone: Tone; solid?: boolean; meta?: string };

export const EVENT_LOOK: Record<EventType, EventLook> = {
  INCIDENT_CREATED: { label: 'Request saved on this device', icon: 'sos', tone: 'coral' },
  REPORT_ADDED: { label: 'Statement added', icon: 'description', tone: 'neutral' },
  AI_PROPOSAL_CREATED: { label: 'AI proposal recorded', icon: 'auto_awesome', tone: 'indigo', meta: 'A proposal, not a fact' },
  STATEMENT_ASSESSED: { label: 'AI compared an update', icon: 'auto_awesome', tone: 'indigo', meta: 'A proposal, not a fact' },
  CLARIFICATION_REQUESTED: { label: 'Clarification requested', icon: 'help', tone: 'indigo' },
  CLARIFICATION_SKIPPED: { label: 'Clarification skipped', icon: 'help', tone: 'gray' },
  CLAIM_CONFIRMED: { label: 'Detail confirmed', icon: 'check', tone: 'green' },
  CONFLICT_FLAGGED: { label: 'Conflicting statements flagged', icon: 'warning', tone: 'amber', meta: 'Both statements are kept' },
  CONFLICT_RESOLVED: { label: 'Conflict resolved by the requester', icon: 'check_circle', tone: 'green' },
  CAPSULE_PREPARED: { label: 'Capsule prepared', icon: 'lock', tone: 'neutral' },
  CAPSULE_QUEUED: { label: 'Capsule queued', icon: 'schedule_send', tone: 'amber', meta: 'Queued is not delivered' },
  PACKET_SENT_ATTEMPT: { label: 'Send attempted', icon: 'send', tone: 'amber', meta: 'Not a delivery' },
  PACKET_RECEIVED_BY_PEER: { label: 'Delivery receipt received', icon: 'done_all', tone: 'green' },
  RESPONDER_ACKNOWLEDGED: { label: 'Marked as seen', icon: 'visibility', tone: 'green', meta: 'Seen is not accepted' },
  RESPONDER_DECLINED: { label: 'Cannot help', icon: 'pan_tool', tone: 'gray' },
  TASK_OFFERED: { label: 'Role offered', icon: 'volunteer_activism', tone: 'neutral' },
  TASK_ACCEPTED: { label: 'Role taken', icon: 'task_alt', tone: 'green' },
  TASK_DECLINED: { label: 'Role declined or released', icon: 'do_not_disturb_on', tone: 'gray' },
  TASK_PROGRESS_REPORTED: { label: 'Progress reported', icon: 'directions_walk', tone: 'green', meta: 'Arrival is not confirmed' },
  TASK_COMPLETION_REPORTED: { label: 'Completion reported', icon: 'hourglass_top', tone: 'amber', meta: 'Waiting for the requester to confirm' },
  TASK_COMPLETION_CONFIRMED: { label: 'Completion confirmed', icon: 'verified', tone: 'green' },
  INCIDENT_RESOLVED: { label: 'Resolved', icon: 'check_circle', tone: 'green', solid: true },
  INCIDENT_CANCELLED: { label: 'Cancelled', icon: 'block', tone: 'gray' },
};

/** What each later step needs before it can be shown as reached. */
export const STEP_REQUIREMENTS: Record<(typeof STEP_LABELS)[number], string> = {
  Saved: 'Written to this device.',
  Delivered: 'Needs a delivery receipt from a trusted device.',
  Seen: 'Needs a responder to mark the request as seen.',
  'Role taken': 'Needs a responder to accept a role.',
  Resolved: 'Needs the requester, or a responder holding a role, to confirm resolution.',
};

export function timeLabel(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${m < 10 ? '0' : ''}${m} ${h < 12 ? 'AM' : 'PM'}`;
}

export function agoLabel(ms: number | null, nowMs: number): string {
  if (ms === null) return 'Never seen';
  const s = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function shortDeviceId(deviceId: string): string {
  return deviceId.length <= 10 ? deviceId : `${deviceId.slice(0, 4)}…${deviceId.slice(-4)}`;
}

export function presentAIState(state: AIState): { label: string; tone: Tone } {
  switch (state) {
    case 'ready':
      return { label: 'Ready offline', tone: 'green' };
    case 'unsupported_locale':
      return { label: 'Unsupported locale', tone: 'amber' };
    case 'model_assets_missing':
      return { label: 'Model not downloaded', tone: 'amber' };
    case 'unavailable':
      return { label: 'Unavailable', tone: 'amber' };
    case 'guardrail_refusal':
      return { label: 'Refused by the model', tone: 'amber' };
    case 'timeout':
      return { label: 'Timed out', tone: 'amber' };
    case 'invalid_output':
      return { label: 'Invalid output', tone: 'amber' };
    case 'native_error':
      return { label: 'Error', tone: 'amber' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'amber' };
    case 'queue_full':
      return { label: 'Busy', tone: 'amber' };
    case 'context_overflow':
      return { label: 'Report too long', tone: 'amber' };
    case 'superseded':
      return { label: 'Replaced by a newer request', tone: 'amber' };
  }
}

/** The text-model line for the Home card. Simulation is always named as such. */
export function presentTextModel(caps: CapabilityMatrix | null): { label: string; tone: Tone } {
  if (!caps) return { label: 'Checking…', tone: 'gray' };
  if (caps.source === 'simulated') return { label: caps.text.state === 'ready' ? 'Simulation' : 'Simulation · unavailable', tone: 'gray' };
  return presentAIState(caps.text.state);
}

export function presentReach(peer: PeerView): { label: string; tone: Tone; online: boolean } {
  if (peer.reach === 'connected') return { label: 'Connected', tone: 'green', online: true };
  if (peer.reach === 'discovered') return { label: 'Nearby · not connected', tone: 'amber', online: false };
  return { label: 'Not reachable', tone: 'gray', online: false };
}

export const DISCOVERY_LABEL: Record<DiscoveryState, string> = {
  off: 'Discovery is off',
  starting: 'Starting discovery…',
  on: 'Looking for nearby devices',
  permission_denied: 'Local Network access is denied',
  error: 'Discovery stopped with an error',
};

export type NetworkLine = { text: string; tone: Tone; icon: IconName };

/** One-line network summary used on Home and Network. Only measured state. */
export function presentNetwork(snapshot: Pick<PulseSnapshot, 'network' | 'peers'>): NetworkLine {
  const trusted = snapshot.peers.filter((p) => p.trusted);
  const connected = trusted.filter((p) => p.reach === 'connected');
  if (snapshot.network.discovery === 'permission_denied') {
    return { text: 'Local Network access is denied · nearby devices cannot be reached', tone: 'amber', icon: 'wifi_off' };
  }
  if (snapshot.network.discovery === 'error') return { text: 'Discovery stopped with an error', tone: 'amber', icon: 'wifi_off' };
  if (trusted.length === 0) return { text: 'No trusted device paired', tone: 'amber', icon: 'link_off' };
  if (snapshot.network.discovery === 'off') return { text: `Discovery is off · ${trusted.length} trusted`, tone: 'amber', icon: 'wifi_off' };
  if (connected.length === 0) {
    return { text: `${trusted.length} trusted · none connected right now`, tone: 'amber', icon: 'link_off' };
  }
  return { text: `${trusted.length} trusted · ${connected.length} connected now`, tone: 'green', icon: 'link' };
}

export function incidentHeadline(view: IncidentView, me: Me): string {
  const type = view.facts.find((f) => f.field === 'incidentType')?.value ?? 'Assistance request';
  if (view.role === 'reporter') return type;
  const reporter = view.state.incident?.reporter;
  return reporter ? `${firstName(displayName(me, reporter.deviceId, reporter.userName))} · ${type}` : type;
}

/** The place in the reporter's words, or null when unknown or not readable on this device. */
export function incidentPlace(view: IncidentView): string | null {
  const get = (field: ClaimField) => {
    const f = view.facts.find((x) => x.field === field);
    return f && !f.protected ? f.value : null;
  };
  const parts = [get('building'), get('floor'), get('locationText')].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}


/** User-visible product name. Data that still says the old name (demo scenario titles) is shown with the new one. */
export const BRAND = 'SAGIP';
export function brand(text: string): string {
  return text.replace(/PULSE(?!-)/g, BRAND);
}

/** "Today", "Yesterday" or "Oct 3" (design `dayOf`, line 959). */
export function dayLabel(ms: number, nowMs: number = Date.now()): string {
  const d = new Date(ms);
  const n = new Date(nowMs);
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, n)) return 'Today';
  const y = new Date(n);
  y.setDate(n.getDate() - 1);
  if (sameDay(d, y)) return 'Yesterday';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
  return `${MONTHS[d.getMonth()] ?? ''} ${d.getDate()}`;
}

/** "Today, 9:41 AM" */
export function whenLabel(ms: number, nowMs: number = Date.now()): string {
  return `${dayLabel(ms, nowMs)}, ${timeLabel(ms)}`;
}

/** Tag pill colours from the design's TAGC table (line 953), keyed by the ledger's provenance tags. */
export const TAG_LOOK: Record<ProvenanceTag, { fg: string; bg: string }> = {
  user_confirmed: { fg: '#1E7F5B', bg: '#E6F5EE' },
  user_reported: { fg: '#151515', bg: '#F2F2F4' },
  responder_reported: { fg: '#151515', bg: '#F2F2F4' },
  ai_proposed: { fg: '#46508A', bg: '#E9EBF6' },
  unresolved: { fg: '#C8433F', bg: '#FDECEB' },
  unknown: { fg: '#86868B', bg: '#F2F2F4' },
};

/** Task pill colours from the design's TS table (line 955). */
export const TASK_LOOK: Record<TaskStatus, { fg: string; bg: string }> = {
  unassigned: { fg: '#86868B', bg: '#F2F2F4' },
  offered: { fg: '#9A6210', bg: '#FDF3E2' },
  accepted: { fg: '#1E7F5B', bg: '#E6F5EE' },
  in_progress: { fg: '#1E7F5B', bg: '#E6F5EE' },
  completion_reported: { fg: '#46508A', bg: '#E9EBF6' },
  completion_confirmed: { fg: '#FFFFFF', bg: '#27A878' },
};

/** Capsule / delivery pill colours from the design's CAPS table (line 956). */
export const DELIVERY_LOOK: Record<DeliveryState, { fg: string; bg: string }> = {
  none: { fg: '#86868B', bg: '#F2F2F4' },
  queued: { fg: '#9A6210', bg: '#FDF3E2' },
  send_attempted: { fg: '#9A6210', bg: '#FDF3E2' },
  delivered: { fg: '#1E7F5B', bg: '#E6F5EE' },
};

export type ReadinessFact = { key: 'text_model' | 'trusted_device' | 'reachable_now'; label: string; ok: boolean };

export type Readiness = {
  facts: ReadinessFact[];
  count: number;
  /** "2 of 3 ready": a count of the three facts, never a safety verdict. */
  title: string;
  /** The design's sub-line, built from the same three facts. */
  line: string;
  progress: number;
};

/**
 * The three capability facts behind the Home ring and the last onboarding step: the on-device text
 * model is ready, at least one trusted device is paired, at least one trusted device is reachable now.
 */
export function presentReadiness(snapshot: Pick<PulseSnapshot, 'capabilities' | 'peers'>): Readiness {
  const caps = snapshot.capabilities;
  const trusted = snapshot.peers.filter((p) => p.trusted);
  const reachable = trusted.filter((p) => p.reach === 'connected');
  const textReady = caps?.text.state === 'ready';
  const facts: ReadinessFact[] = [
    { key: 'text_model', label: 'On-device text model ready', ok: textReady },
    { key: 'trusted_device', label: 'At least one trusted device', ok: trusted.length > 0 },
    { key: 'reachable_now', label: 'At least one reachable now', ok: reachable.length > 0 },
  ];
  const count = facts.filter((f) => f.ok).length;
  const ai = !caps ? 'Local AI checking' : caps.source === 'simulated' ? (textReady ? 'Local AI simulated' : 'Local AI off (simulated)') : textReady ? 'Local AI ready' : 'Local AI unavailable';
  const line = [ai, `${trusted.length} trusted`, reachable.length > 0 ? `${reachable.length} reachable now` : 'No reachable peer'].join(' · ');
  return { facts, count, title: `${count} of 3 ready`, line, progress: count / 3 };
}

/** One line for the "On-Device Intelligence" overview row. */
export function presentIntelligenceLine(caps: CapabilityMatrix | null): string {
  if (!caps) return 'Checking this iPhone…';
  if (caps.source === 'simulated') return caps.text.state === 'ready' ? 'Simulation · no cloud AI' : 'Simulation off · manual SOS still works';
  if (caps.text.state === 'ready') return 'Ready offline · no cloud AI needed';
  return `${presentAIState(caps.text.state).label} · manual SOS still works`;
}
