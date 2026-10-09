import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { CLARIFIABLE_FIELDS, type ClarifiableField } from '@/ai';
import { canAddReport, canRequestClarification, canResolveConflict, canSkipClarification, type Actor, type ClaimField } from '@/domain';
import type { FactView, IncidentView, UpdateView } from '@/services/api';
import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Avatar, ChoiceChip, Enter, Icon, LinkButton, Pill, colors, design, tones } from '@/ui';
import { Text, TextInput } from '@/ui/Text';

import { routes } from '../nav';
import { BRAND, displayName, FIELD_LABELS, firstName, presentUpdate, PROVENANCE, TAG_LOOK, timeLabel } from '../present';
import { DetailsSheet } from './DetailsSheet';
import { CardBox, INK_LINES, MoreRow, SectionTitle, TagPill } from './parts';
import { useRun } from './useRun';

const FLOOR_ANSWERS = ['Ground floor', 'Second floor', 'Third floor'] as const;

function isClarifiable(field: ClaimField): field is ClarifiableField {
  return (CLARIFIABLE_FIELDS as readonly string[]).includes(field);
}

export function ProvenanceChip({ tag }: { tag: FactView['tag'] }) {
  const look = TAG_LOOK[tag];
  return <TagPill label={PROVENANCE[tag].label} fg={look.fg} bg={look.bg} />;
}

function factValue(fact: FactView): string {
  if (fact.protected) return 'Protected';
  if (fact.tag === 'unresolved') return 'Two statements disagree';
  return fact.value ?? 'Unknown';
}

/** Details row (design 514): 12pt grey label, 15/600 value, tag pill; padding 12/16, gap 12. */
export function FactRow({ fact, first }: { fact: FactView; first: boolean }) {
  const label = FIELD_LABELS[fact.field];
  const value = factValue(fact);
  return (
    <View
      testID={`fact-${fact.field}`}
      accessible
      accessibilityLabel={`${label}: ${value}. ${fact.protected ? 'Not readable on this device' : PROVENANCE[fact.tag].label}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: first ? 0 : 1, borderTopColor: colors.hairline }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 12, color: colors.gray1 }}>{label}</Text>
        <Text style={{ fontSize: 15, fontWeight: '600', marginTop: 1, color: fact.protected || fact.value === null ? colors.gray1 : colors.ink }}>{value}</Text>
      </View>
      {fact.protected ? (
        <View testID={`fact-lock-${fact.field}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.hairline, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 8 }}>
          <Icon name="lock" size={13} color={colors.gray1} />
          <Text style={{ fontSize: 11, fontWeight: '700', color: colors.gray1 }}>protected</Text>
        </View>
      ) : (
        <ProvenanceChip tag={fact.tag} />
      )}
    </View>
  );
}

/** Conflict card (design 474–486). */
function ConflictCard({ view, actor, fact, conflictId }: { view: IncidentView; actor: Actor; fact: FactView; conflictId: string }) {
  const actions = usePulseActions();
  const { busy, run } = useRun();
  const [asked, setAsked] = useState(false);
  const [kept, setKept] = useState(false);
  const mayResolve = canResolveConflict(view.state, actor, conflictId).ok;
  const mayAsk = canRequestClarification(view.state, actor).ok && !mayResolve;
  const reporter = view.state.incident?.reporter;
  const title = fact.field === 'floor' ? 'Two different floors reported' : `Two different answers for ${FIELD_LABELS[fact.field].toLowerCase()}`;
  return (
    <Enter testID={`conflict-${fact.field}`} kind="popIn" duration={350} style={{ backgroundColor: '#FFFFFF', borderRadius: 22, borderWidth: 1.5, borderColor: INK_LINES.coralLine, padding: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name="call_split" size={20} color={colors.coralText} />
        <Text accessibilityRole="header" style={{ flex: 1, fontSize: 15.5, fontWeight: '700', color: colors.ink }}>
          {title}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {fact.candidates.map((c, i) => (
          <View key={`${c.by}-${c.value}`} testID={`conflict-value-${c.value}`} style={{ flex: 1, backgroundColor: i === 0 ? colors.page : design.conflictTint, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 12 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>{c.value}</Text>
            <Text style={{ fontSize: 12, color: colors.gray1, marginTop: 2 }}>{c.by}</Text>
          </View>
        ))}
      </View>
      {mayResolve ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {fact.candidates.map((c, i) => (
            <Pill
              key={`${c.by}-${c.value}`}
              testID={`conflict-pick-${c.value}`}
              flex
              label={c.value}
              accessibilityLabel={`Confirm ${c.value}`}
              tone={i === 0 ? 'ink' : 'soft'}
              h={42}
              size={14}
              disabled={busy !== null}
              onPress={() => void run('resolve', () => actions.resolveConflict(view.id, conflictId, c.value))}
            />
          ))}
        </View>
      ) : null}
      {kept ? (
        <Text testID="conflict-kept" accessibilityLiveRegion="polite" style={{ fontSize: 12.5, fontWeight: '600', color: colors.amberText }}>
          Kept unresolved. Both reports stay visible.
        </Text>
      ) : asked ? (
        <Text testID="conflict-asked" accessibilityLiveRegion="polite" style={{ fontSize: 12.5, fontWeight: '600', color: colors.amberText }}>
          Clarification requested from {reporter ? firstName(reporter.userName) : 'the requester'}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 20 }}>
        {mayAsk ? (
          <LinkButton
            testID="conflict-ask"
            label="Request clarification"
            size={14}
            h={28}
            disabled={busy !== null || asked}
            onPress={async () => {
              const r = await run('ask', () => actions.requestConflictClarification(view.id, conflictId));
              if (r.ok) setAsked(true);
            }}
          />
        ) : null}
        <LinkButton testID="conflict-keep" label="Keep unresolved" size={14} h={28} color={colors.gray1} onPress={() => setKept(true)} />
      </View>
    </Enter>
  );
}

/** Clarification card (design 488–495). */
function ClarificationCard({ view, actor, questionId }: { view: IncidentView; actor: Actor; questionId: string }) {
  const actions = usePulseActions();
  const { busy, run } = useRun();
  const [typing, setTyping] = useState(false);
  const [answer, setAnswer] = useState('');
  const question = view.state.questions.find((q) => q.id === questionId);
  if (!question) return null;
  const field = question.field;
  const fromAI = question.origin === 'ai';
  const clarifiable = isClarifiable(field) ? field : null;
  const mayAnswer = canSkipClarification(view.state, actor, questionId).ok && clarifiable !== null;
  const send = (value: string) => {
    if (clarifiable === null || value.trim().length === 0) return;
    void run('answer', () => actions.answerClarification(view.id, clarifiable, value.trim()));
  };
  return (
    <Enter testID="clarification-card" kind="popIn" duration={400} ease="spring" style={{ backgroundColor: '#FFFFFF', borderRadius: 24, borderWidth: 1, borderColor: INK_LINES.indigoLine, padding: 18, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={fromAI ? 'auto_awesome' : 'help'} size={16} color={colors.indigo} />
        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.indigo }}>{fromAI ? 'Suggested by AI · ' : ''}Missing context</Text>
      </View>
      <Text accessibilityRole="header" style={{ fontSize: 21, fontWeight: '800', letterSpacing: -0.6, color: colors.ink }}>
        One more detail could help.
      </Text>
      <Text style={{ fontSize: 16, color: colors.gray3 }}>“{question.prompt}”</Text>
      {mayAnswer && clarifiable !== null ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {field === 'floor' ? FLOOR_ANSWERS.map((v) => <ChoiceChip key={v} testID={`clarification-quick-${v}`} label={v} onPress={() => send(v)} />) : null}
            <ChoiceChip testID="clarification-type" label="Type answer" onPress={() => setTyping(true)} />
            <ChoiceChip testID="clarification-skip" ghost label="Skip for now" onPress={() => void run('skip', () => actions.skipClarification(view.id, clarifiable))} />
          </View>
          {typing ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                testID="clarification-answer"
                accessibilityLabel="Your answer"
                value={answer}
                onChangeText={setAnswer}
                placeholder="e.g. Fourth floor"
                placeholderTextColor={colors.gray4}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => send(answer)}
                style={{ flex: 1, minWidth: 0, minHeight: 44, borderRadius: 13, borderWidth: 1, borderColor: colors.lineInput, backgroundColor: INK_LINES.fillInput, paddingHorizontal: 14, paddingVertical: 0, fontSize: 16, color: colors.ink }}
              />
              <Pill testID="clarification-submit" label="Add" h={44} size={15} px={18} disabled={busy !== null || answer.trim().length === 0} onPress={() => send(answer)} />
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="check_circle" size={15} color={colors.gray1} />
            <Text style={{ flex: 1, fontSize: 12, color: colors.gray1 }}>Your SOS is already saved. Answering is optional.</Text>
          </View>
        </>
      ) : (
        <Text style={{ fontSize: 13, color: colors.gray1 }}>Waiting for the requester. Only they can answer or skip it.</Text>
      )}
    </Enter>
  );
}

/** "How SAGIP understood this" (design 541–546, with the AI sheet's evidence rows from 791). */
function Evidence({ view, actor }: { view: IncidentView; actor: Actor }) {
  const withEvidence = view.facts.filter((f) => !f.protected && f.evidence !== null && f.value !== null);
  const hasAI = view.facts.some((f) => f.tag === 'ai_proposed');
  const reportText =
    view.originalReport !== null
      ? `“${view.originalReport}”`
      : view.role === 'reporter' && view.state.reports.every((r) => r.kind !== 'report')
        ? 'No written report. Created from a manual SOS.'
        : 'Not readable on this device.';
  return (
    <View testID="evidence" style={{ paddingTop: 4, paddingHorizontal: 16, paddingBottom: 14, gap: 8 }}>
      <View style={{ backgroundColor: colors.page, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12 }}>
        <Text testID="original-report" style={{ fontSize: 13.5, lineHeight: 19.6, color: colors.ink }}>
          {reportText}
        </Text>
      </View>
      {view.state.reports.map((r) => (
        <View key={r.id} testID={`statement-${r.id}`} style={{ flexDirection: 'row', gap: 10, paddingVertical: 4 }}>
          <Avatar name={r.author.userName} size={26} self={r.author.deviceId === actor.deviceId} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 12, color: colors.gray1 }}>
              {displayName(actor, r.author.deviceId, r.author.userName)} · {timeLabel(r.wallClockMs)}
            </Text>
            <Text style={{ fontSize: 13.5, lineHeight: 18.9, marginTop: 1, color: colors.ink }}>{r.kind === 'report' && view.originalReport === null ? 'Not readable on this device.' : r.text}</Text>
          </View>
        </View>
      ))}
      {withEvidence.length > 0 ? (
        <View>
          {withEvidence.map((f) => {
            const look = TAG_LOOK[f.tag];
            return (
              <View key={f.field} testID={`evidence-${f.field}`} style={{ paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: colors.ink }}>
                    {FIELD_LABELS[f.field]} · {f.value}
                  </Text>
                  <TagPill label={PROVENANCE[f.tag].label} fg={look.fg} bg={look.bg} weight="600" py={3} />
                </View>
                <Text style={{ fontSize: 12.5, color: colors.gray1, marginTop: 3, fontStyle: 'italic' }}>“{f.evidence}”</Text>
              </View>
            );
          })}
        </View>
      ) : null}
      {hasAI ? (
        <Text testID="ai-note" style={{ fontSize: 13, lineHeight: 18.2, color: INK_LINES.amberDeep }}>
          AI interpretation may be inaccurate.
        </Text>
      ) : null}
    </View>
  );
}

const UPDATES_SHOWN = 5;

/**
 * One later statement and how it reads against what was already known. A derived reading or an AI
 * proposal, never a fact, and never the statement's words (those follow the disclosure rules elsewhere).
 */
function UpdateRow({ update, role, first }: { update: UpdateView; role: IncidentView['role']; first: boolean }) {
  const p = presentUpdate(update, role);
  const look = tones[p.tone];
  return (
    <View
      testID={`update-${update.reportId}`}
      accessible
      accessibilityLabel={p.accessibilityLabel}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: first ? 0 : 1, borderTopColor: colors.hairline }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 12, color: colors.gray1 }}>{p.fields.length > 0 ? `${update.by} · ${p.fields}` : update.by}</Text>
        <Text style={{ fontSize: 15, fontWeight: '600', marginTop: 1, color: colors.ink }}>{p.label}</Text>
        <Text testID={`update-basis-${update.reportId}`} style={{ fontSize: 12, marginTop: 2, color: p.fromModel ? colors.indigo : colors.gray1 }}>
          {p.basis}
        </Text>
      </View>
      {p.flag !== null ? <TagPill testID={`update-flag-${update.reportId}`} label={p.flag} fg={look.fg} bg={look.bg} /> : null}
    </View>
  );
}

/** "Updates": every statement after the first, newest first, five at a time. Renders nothing without one. */
function UpdatesCard({ view }: { view: IncidentView }) {
  const [all, setAll] = useState(false);
  if (view.updates.length === 0) return null;
  const newestFirst = [...view.updates].reverse();
  const shown = all ? newestFirst : newestFirst.slice(0, UPDATES_SHOWN);
  const more = newestFirst.length - shown.length;
  return (
    <>
      <SectionTitle>Updates</SectionTitle>
      <CardBox testID="updates-card">
        {shown.map((u, i) => (
          <UpdateRow key={u.reportId} update={u} role={view.role} first={i === 0} />
        ))}
        {more > 0 ? (
          <View style={{ alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.hairline }}>
            <LinkButton testID="updates-show-all" label={`Show ${more} earlier`} size={14} h={44} color={colors.gray1} onPress={() => setAll(true)} />
          </View>
        ) : null}
      </CardBox>
    </>
  );
}

/**
 * Intelligence segment: conflict cards, resolved note, clarification card, Details facts, Updates, and the
 * design's "More" card with "How SAGIP understood this", Add observation and Incident details.
 */
export function IntelligenceTab({ view, actor }: { view: IncidentView; actor: Actor }) {
  const { mode } = usePulse();
  const actions = usePulseActions();
  const { busy, run } = useRun();
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [observing, setObserving] = useState(false);
  const [text, setText] = useState('');
  const [details, setDetails] = useState(false);

  const state = view.state;
  const conflicts = state.contradictions.filter((c) => c.status === 'open');
  const lastResolved = state.contradictions.filter((c) => c.status === 'resolved' && c.resolution !== null).slice(-1)[0];
  const questions = state.questions.filter((q) => q.status === 'open');
  const visible = view.facts.filter((f) => !f.protected);
  const hidden = view.facts.length - visible.length;
  const mayObserve = canAddReport(state, actor, 'observation').ok;
  const mayDescribe = view.role === 'reporter' && canAddReport(state, actor, 'report').ok && state.reports.length === 0;
  const reporter = state.incident?.reporter;
  const resolution = lastResolved?.resolution ?? null;
  const resolvedBy = resolution ? (resolution.resolvedBy.deviceId === actor.deviceId ? 'you' : firstName(resolution.resolvedBy.userName)) : '';

  return (
    <>
      {conflicts.map((c) => {
        const fact = view.facts.find((f) => f.field === c.field);
        return fact ? <ConflictCard key={c.id} view={view} actor={actor} fact={fact} conflictId={c.id} /> : null;
      })}
      {lastResolved && resolution && conflicts.length === 0 ? (
        <View testID="resolved-note" style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: colors.greenTint, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 14 }}>
          <Icon name="check_circle" size={18} color={colors.greenText} filled />
          <Text style={{ flex: 1, fontSize: 13.5, fontWeight: '600', lineHeight: 18.9, color: colors.greenText }}>
            {FIELD_LABELS[lastResolved.field]} confirmed by {resolvedBy}: {resolution.value}. The other statement is kept in the history.
          </Text>
        </View>
      ) : null}
      {questions.slice(0, 1).map((q) => (
        <ClarificationCard key={q.id} view={view} actor={actor} questionId={q.id} />
      ))}

      <SectionTitle>Details</SectionTitle>
      <CardBox testID="facts-card">
        {visible.map((f, i) => (
          <FactRow key={f.field} fact={f} first={i === 0} />
        ))}
        {hidden > 0 ? (
          <View testID="facts-protected-note" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 16, borderTopWidth: visible.length > 0 ? 1 : 0, borderTopColor: colors.hairline }}>
            <Icon name="lock" size={15} color={colors.gray2} />
            <Text style={{ flex: 1, fontSize: 12.5, color: colors.gray2 }}>
              {hidden} {hidden === 1 ? 'field' : 'fields'} not shared with this device at your access level
            </Text>
          </View>
        ) : null}
      </CardBox>

      <UpdatesCard view={view} />

      <SectionTitle>More</SectionTitle>
      <CardBox testID="more-card">
        <MoreRow first testID="toggle-evidence" icon="auto_awesome" label={`How ${BRAND} understood this`} expanded={evidenceOpen} onPress={() => setEvidenceOpen((o) => !o)} />
        {evidenceOpen ? <Evidence view={view} actor={actor} /> : null}
        {mayObserve ? <MoreRow testID="add-observation" icon="add_comment" label="Add observation" expanded={observing} onPress={() => setObserving(true)} /> : null}
        {mayObserve && observing ? (
          <View style={{ paddingTop: 4, paddingHorizontal: 16, paddingBottom: 14, gap: 8 }}>
            <TextInput
              testID="observation-input"
              accessibilityLabel="Observation"
              value={text}
              onChangeText={setText}
              placeholder="What do you see? Where is the requester?"
              placeholderTextColor={colors.gray4}
              multiline
              textAlignVertical="top"
              style={{ minHeight: 66, borderRadius: 12, borderWidth: 1, borderColor: colors.lineInput, backgroundColor: INK_LINES.fillInput, paddingVertical: 10, paddingHorizontal: 12, fontSize: 15, lineHeight: 21, color: colors.ink }}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {mode === 'demo' ? (
                <LinkButton
                  testID="observation-example"
                  label="Use example"
                  size={14}
                  h={28}
                  color={colors.gray1}
                  onPress={() => setText(view.role === 'reporter' ? 'I’m on the second floor near the stairs.' : `${reporter ? firstName(reporter.userName) : 'The requester'} is near the stairs on the first floor.`)}
                />
              ) : null}
              <View style={{ flex: 1 }} />
              <Pill
                testID="observation-submit"
                label="Submit"
                h={36}
                size={13.5}
                px={16}
                disabled={busy !== null || text.trim().length === 0}
                onPress={async () => {
                  const r = await run('observe', () => actions.addObservation(view.id, text.trim()));
                  if (r.ok) {
                    setText('');
                    setObserving(false);
                  }
                }}
              />
            </View>
          </View>
        ) : null}
        {mayDescribe ? <MoreRow testID="describe" icon="auto_awesome" label="Describe what happened" onPress={() => router.push(routes.report(view.id))} /> : null}
        <MoreRow testID="open-details" icon="description" label="Incident details" onPress={() => setDetails(true)} />
      </CardBox>

      <DetailsSheet view={view} visible={details} onClose={() => setDetails(false)} />
    </>
  );
}
