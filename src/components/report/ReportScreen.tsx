import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PROPOSAL_FIELDS, type AIFailureState, type AISource, type ClarificationProposal, type IncidentProposal, type ProposalField } from '@/ai';
import { canAddReport } from '@/domain';
import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Banner, ChoiceChip, Enter, Icon, IconButton, Pill, PulseRing, Ring, SegmentedControl, Spinner, WaveBars, colors, padBottom, useToast, type IconName } from '@/ui';

import { useActor } from '../incident/useMe';
import { useRun } from '../incident/useRun';
import { routes } from '../nav';
import { BRAND, FIELD_LABELS, presentAIState, PROVENANCE, TAG_LOOK } from '../present';
import { startRecording, type Recording } from './voice';

/**
 * Local AI analysis of an optional report (design 704–807). The SOS already exists before this
 * screen opens, so nothing here can delay it.
 *
 * The four processing steps are real awaited stages, so the ring's percentage is measured progress:
 * save the report, run on-device extraction, record the proposal in the ledger as AI-proposed
 * claims, ask for one optional clarification. The proposal is attached as soon as the analysis
 * succeeds (and again on unmount if that had not finished), so leaving with the back gesture never
 * loses it. Nothing becomes a confirmed fact until the person presses "Confirm interpretation".
 */
type Phase =
  | { k: 'input' }
  | { k: 'processing'; step: number }
  | { k: 'result'; reportId: string; proposal: IncidentProposal; source: AISource; latencyMs: number }
  | { k: 'unavailable'; reason: AIFailureState };

type Voice = { k: 'idle' } | { k: 'starting' } | { k: 'recording' } | { k: 'transcribing' } | { k: 'failed'; message: string };

const INPUT_MODES: readonly { key: 'voice' | 'type'; label: string; icon: IconName }[] = [
  { key: 'voice', label: 'Voice report', icon: 'mic' },
  { key: 'type', label: 'Type', icon: 'keyboard' },
];

const STEPS = ['Saving your report on this device', 'Extracting relevant information', 'Preparing incident record', 'Checking for missing context'] as const;

/** The design's sample report. Canned content, so it is offered in Demo mode only. */
const SAMPLE = 'Nadulas ako sa hagdan sa Building B. Masakit paa ko at kailangan ko ng tulong.';

const FLOOR_ANSWERS = ['Ground floor', 'Second floor', 'Third floor'] as const;
/** Rows under the hero card; type and building are in the hero itself. */
const CARD_FIELDS: readonly ProposalField[] = ['floor', 'locationText', 'symptom', 'assistanceRequested'];

type Values = Partial<Record<ProposalField, string>>;

function TagPill({ label, fg, bg, small }: { label: string; fg: string; bg: string; small?: boolean }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingVertical: small ? 3 : 4, paddingHorizontal: 8 }}>
      <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: small ? '600' : '700', color: fg }}>
        {label}
      </Text>
    </View>
  );
}

export function ReportScreen({ incidentId }: { incidentId: string }) {
  const snapshot = usePulse();
  const actions = usePulseActions();
  const actor = useActor();
  const insets = useSafeAreaInsets();
  const toast = useToast((s) => s.show);
  const { busy, run } = useRun();
  const view = snapshot.incidents.find((i) => i.id === incidentId);
  const caps = snapshot.capabilities;
  const demo = snapshot.mode === 'demo';
  const textReady = caps?.text.state === 'ready';

  const [mode, setMode] = useState<'type' | 'voice'>('type');
  const [text, setText] = useState('');
  const [inputMode, setInputMode] = useState<'typed' | 'transcribed'>('typed');
  const [phase, setPhase] = useState<Phase>({ k: 'input' });
  const [notSaved, setNotSaved] = useState(false);
  const [voice, setVoice] = useState<Voice>({ k: 'idle' });
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Values>({});
  /** The value each field held when the person last confirmed it. */
  const [confirmed, setConfirmed] = useState<Values>({});
  const [confirmedOnce, setConfirmedOnce] = useState(false);
  const [clarification, setClarification] = useState<ClarificationProposal>(null);
  const [clarState, setClarState] = useState<'open' | 'answered' | 'skipped'>('open');
  const [typing, setTyping] = useState(false);
  const [answer, setAnswer] = useState('');
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const recording = useRef<Recording | null>(null);
  const alive = useRef(true);
  const pending = useRef<{ reportId: string; proposal: IncidentProposal } | null>(null);
  const attaching = useRef<Promise<boolean> | null>(null);

  /** Records the proposal in the ledger exactly once; a failed attempt may be retried. */
  const ensureAttached = useCallback((): Promise<boolean> => {
    if (attaching.current) return attaching.current;
    const job = pending.current;
    if (!job) return Promise.resolve(false);
    const attempt = actions
      .attachProposal(incidentId, job.reportId, job.proposal)
      .then(
        (r) => r.ok,
        () => false,
      )
      .then((ok) => {
        if (!ok) attaching.current = null;
        return ok;
      });
    attaching.current = attempt;
    return attempt;
  }, [actions, incidentId]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void recording.current?.stop();
      // Left by the back gesture before the proposal was recorded: record it now.
      void ensureAttached();
    };
  }, [ensureAttached]);

  // Returns to the incident if it is already in the stack, otherwise replaces this screen with it.
  const close = () => router.dismissTo(routes.incident(incidentId));

  const submit = async () => {
    const body = text.trim();
    if (body.length === 0 || phase.k === 'processing') return;
    setNotSaved(false);
    setPhase({ k: 'processing', step: 0 });
    let saved: Awaited<ReturnType<typeof actions.addReport>>;
    try {
      saved = await actions.addReport(incidentId, body, inputMode);
    } catch {
      saved = { ok: false, code: 'unexpected', message: '' };
    }
    if (!alive.current) return;
    if (!saved.ok) {
      setNotSaved(true);
      setPhase({ k: 'input' });
      return;
    }
    const reportId = saved.value.reportId;
    setPhase({ k: 'processing', step: 1 });
    const result = await actions.analyzeReport(incidentId, reportId);
    if (!result.ok) {
      if (alive.current) setPhase({ k: 'unavailable', reason: result.state });
      return;
    }
    // From here the proposal exists; it is recorded even if this screen is gone.
    pending.current = { reportId, proposal: result.value };
    if (alive.current) setPhase({ k: 'processing', step: 2 });
    await ensureAttached();
    if (!alive.current) return;
    setPhase({ k: 'processing', step: 3 });
    let question: ClarificationProposal = null;
    try {
      const asked = await actions.suggestClarification(incidentId);
      if (asked.ok) question = asked.value;
    } catch {
      question = null;
    }
    if (!alive.current) return;
    const initial: Values = {};
    for (const field of PROPOSAL_FIELDS) {
      const f = result.value.fields[field];
      if (f) initial[field] = f.value;
    }
    setValues(initial);
    setClarification(question);
    setPhase({ k: 'processing', step: 4 });
    // The design holds the full ring for a moment before the result appears.
    await new Promise((resolve) => setTimeout(resolve, 450));
    if (!alive.current) return;
    setPhase({ k: 'result', reportId, proposal: result.value, source: result.meta.source, latencyMs: result.meta.latencyMs });
  };

  /** Confirms every field whose current value is non-empty and differs from what was last confirmed. */
  const confirmChanged = async (): Promise<boolean> => {
    if (!(await ensureAttached())) {
      toast('The proposal could not be recorded. Nothing was changed.', 'error', colors.amber);
      return false;
    }
    for (const field of PROPOSAL_FIELDS) {
      const value = values[field]?.trim();
      if (!value || confirmed[field] === value) continue;
      const r = await run(`confirm-${field}`, () => actions.confirmFact(incidentId, field, value));
      if (!r.ok) return false;
      setConfirmed((c) => ({ ...c, [field]: value }));
    }
    return true;
  };

  const confirmAll = async () => {
    if (await confirmChanged()) {
      setConfirmedOnce(true);
      setEditing(false);
    }
  };

  const sendUpdated = async () => {
    if (await confirmChanged()) {
      setEditing(false);
      toast('Updated details saved', 'send');
    }
  };

  const answerQuestion = async (value: string) => {
    if (!clarification || value.trim().length === 0) return;
    const r = await run('answer', () => actions.answerClarification(incidentId, clarification.field, value.trim()));
    if (!r.ok) return;
    setClarState('answered');
    setTyping(false);
    setAnswer('');
    if (clarification.field in FIELD_LABELS) {
      setValues((v) => ({ ...v, [clarification.field]: value.trim() }));
      setConfirmed((c) => ({ ...c, [clarification.field]: value.trim() }));
    }
  };

  const skipQuestion = async () => {
    if (!clarification) return;
    const r = await run('skip', () => actions.skipClarification(incidentId, clarification.field));
    if (r.ok) {
      setClarState('skipped');
      setTyping(false);
    }
  };

  const onMic = async () => {
    if (voice.k === 'starting' || voice.k === 'transcribing') return;
    if (voice.k === 'recording') {
      setVoice({ k: 'transcribing' });
      const uri = (await recording.current?.stop()) ?? null;
      recording.current = null;
      if (!alive.current) return;
      if (uri === null) {
        setVoice({ k: 'failed', message: 'The recording could not be saved. You can type instead.' });
        setMode('type');
        return;
      }
      const result = await actions.transcribe(uri, snapshot.settings.reportLocale);
      if (!alive.current) return;
      if (result.ok && result.value.text.trim().length > 0) {
        setText(result.value.text.trim());
        setInputMode('transcribed');
        setVoice({ k: 'idle' });
      } else {
        const why = result.ok ? 'no speech was recognised' : presentAIState(result.state).label.toLowerCase();
        setVoice({ k: 'failed', message: `On-device transcription did not work (${why}) for ${snapshot.settings.reportLocale}. You can type instead.` });
        setMode('type');
      }
      return;
    }
    setVoice({ k: 'starting' });
    const started = await startRecording();
    if (!alive.current) {
      if (started.ok) void started.recording.stop();
      return;
    }
    if (!started.ok) {
      setVoice({
        k: 'failed',
        message: started.reason === 'permission_denied' ? 'Microphone access was not granted. You can type instead, or allow the microphone in iOS Settings.' : 'Recording could not start on this device. You can type instead.',
      });
      setMode('type');
      return;
    }
    recording.current = started.recording;
    setText('');
    setVoice({ k: 'recording' });
  };

  const badgeText = !caps
    ? 'Local AI · checking'
    : !textReady
      ? `Basic mode · ${caps.device.model}`
      : caps.source === 'simulated'
        ? `Simulated Local AI — ${caps.device.model}`
        : `${caps.provider} — ${caps.device.model}`;

  const header = (onClose: () => void) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 8, paddingHorizontal: 20 }}>
      <IconButton testID="report-close" icon="close" label="Close" onPress={onClose} size={40} />
      <View testID="ai-badge" style={{ flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 }}>
        <Icon name="memory" size={16} />
        <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, fontWeight: '600', color: colors.ink }}>
          {badgeText}
        </Text>
      </View>
      <View style={{ width: 40 }} />
    </View>
  );

  const shell = (body: ReactNode, footer: ReactNode, onClose: () => void = close) => (
    <View testID="report-screen" style={{ flex: 1, backgroundColor: colors.page, paddingTop: insets.top }}>
      {header(onClose)}
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 18, paddingHorizontal: 20, paddingBottom: 16, gap: 16 }}>
        {body}
      </ScrollView>
      <View style={{ paddingTop: 10, paddingHorizontal: 20, paddingBottom: padBottom(insets.bottom), gap: 10 }}>{footer}</View>
    </View>
  );

  const heading = (title: string, sub?: string) => (
    <View>
      <Text accessibilityRole="header" style={{ fontSize: 30, lineHeight: 33, fontWeight: '700', letterSpacing: -0.9, color: colors.ink }}>
        {title}
      </Text>
      {sub ? <Text style={{ fontSize: 15, lineHeight: 21, color: colors.gray1, marginTop: 8 }}>{sub}</Text> : null}
    </View>
  );

  if (!view) {
    return shell(heading('Request not found', 'This request is not on this device.'), null, () => router.replace(routes.home));
  }

  const mayReport = canAddReport(view.state, actor, 'report').ok;
  if (!mayReport && phase.k === 'input') {
    return shell(
      heading('Report unavailable', view.state.closure ? 'This request is closed, so no report can be added.' : 'Only the requester can add the report. You can add an observation from the request.'),
      <Pill testID="view-incident" label="View incident" h={58} size={17} onPress={close} />,
    );
  }

  const savedBanner = confirmedOnce ? null : (
    <Banner testID="saved-banner" tone="coral" icon="sos" filled weight="500" text={`Your request ${view.shortId} is already saved on this device. Anything you add here is attached to it.`} />
  );

  if (phase.k === 'processing') {
    return shell(
      <>
        {savedBanner}
        <Enter kind="fadeUp" duration={300} style={{ alignItems: 'center', gap: 24, paddingTop: 16 }}>
          <Ring size={150} r={64} stroke={10} progress={phase.step / STEPS.length} track={colors.fillSeg} durationMs={800} ease="spring">
            <Text testID="processing-percent" style={{ fontSize: 30, fontWeight: '700', letterSpacing: -0.9, color: colors.ink }}>
              {Math.round((phase.step / STEPS.length) * 100)}%
            </Text>
            <Text style={{ fontSize: 12, fontWeight: '600', color: colors.gray1 }}>on-device</Text>
          </Ring>
          <View style={{ alignItems: 'center' }}>
            <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={{ fontSize: 26, fontWeight: '800', letterSpacing: -0.8, color: colors.ink }}>
              Understanding locally
            </Text>
            <Text style={{ fontSize: 13, color: colors.gray1, marginTop: 4, textAlign: 'center' }}>{badgeText}</Text>
          </View>
          <View style={{ alignSelf: 'stretch', backgroundColor: '#FFFFFF', borderRadius: 24, overflow: 'hidden' }}>
            {STEPS.map((label, i) => {
              const done = phase.step > i;
              const current = phase.step === i;
              return (
                <View
                  key={label}
                  testID={`processing-step-${i}`}
                  accessible
                  accessibilityLabel={`${label}: ${done ? 'done' : current ? 'in progress' : 'not started'}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15, paddingHorizontal: 16, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
                  {done ? (
                    <Icon name="check_circle" size={22} color={colors.green} filled />
                  ) : current ? (
                    <View style={{ margin: 2 }}>
                      <Spinner size={18} width={2.5} />
                    </View>
                  ) : (
                    <View style={{ width: 18, height: 18, margin: 2, borderRadius: 9, borderWidth: 2, borderColor: colors.track }} />
                  )}
                  <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: phase.step >= i ? colors.ink : colors.gray4 }}>{label}</Text>
                </View>
              );
            })}
          </View>
        </Enter>
      </>,
      null,
    );
  }

  if (phase.k === 'unavailable') {
    return shell(
      <>
        {heading('Report attached')}
        <Banner testID="ai-unavailable" roomy text="Local AI unavailable — sending original report." />
        <View style={{ backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, gap: 6 }}>
          <Text style={{ fontSize: 12, color: colors.gray1 }}>On-device model</Text>
          <Text testID="ai-unavailable-reason" style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>
            {presentAIState(phase.reason).label}
          </Text>
          <Text style={{ fontSize: 13.5, lineHeight: 19.6, color: colors.gray2 }}>
            Your words are attached to the request exactly as you wrote them. No details were extracted and nothing was guessed. The request itself was already saved.
          </Text>
        </View>
        <View style={{ backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>Your report</Text>
          <View style={{ backgroundColor: colors.page, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, marginTop: 12 }}>
            <Text style={{ fontSize: 14, lineHeight: 20.3, color: colors.ink }}>“{text.trim()}”</Text>
          </View>
        </View>
      </>,
      <Pill testID="view-incident" label="View incident" h={58} size={17} onPress={close} />,
    );
  }

  if (phase.k === 'result') {
    const proposal = phase.proposal;
    const tagOf = (field: ProposalField) => {
      const value = values[field]?.trim() ?? '';
      if (value.length > 0 && confirmed[field] === value) return { label: PROVENANCE.user_confirmed.label, ...TAG_LOOK.user_confirmed };
      if (value.length > 0 && proposal.fields[field] !== undefined) return { label: PROVENANCE.ai_proposed.label, ...TAG_LOOK.ai_proposed };
      if (value.length > 0) return { label: 'not confirmed yet', ...TAG_LOOK.user_reported };
      return { label: PROVENANCE.unknown.label, ...TAG_LOOK.unknown };
    };
    const shown = (field: ProposalField) => {
      const value = values[field]?.trim() ?? '';
      return value.length > 0 ? value : 'Unknown';
    };
    const currentType = view.facts.find((f) => f.field === 'incidentType' && !f.protected)?.value ?? 'Assistance request';
    const type = (values.incidentType?.trim() ?? '').length > 0 ? shown('incidentType') : currentType;
    const building = (values.building?.trim() ?? '').length > 0 ? shown('building') : 'Location unknown';
    const floor = (values.floor?.trim() ?? '').length > 0 ? shown('floor') : 'floor unknown';
    const dirty = PROPOSAL_FIELDS.some((f) => {
      const value = values[f]?.trim() ?? '';
      return value.length > 0 && confirmed[f] !== value;
    });
    const showClar = clarification !== null && clarState === 'open' && !editing;
    const clarLabel = clarification ? FIELD_LABELS[clarification.field] : '';

    const footer = confirmedOnce ? (
      <View style={{ gap: 10 }}>
        <Pill testID="view-incident" label="View incident" h={58} size={17} onPress={close} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pill testID="edit-toggle" flex label={editing ? 'Done editing' : 'Edit extracted details'} tone="soft" h={50} size={14.5} onPress={() => setEditing((e) => !e)} />
          <Pill testID="send-updated" flex label="Send updated details" tone="soft" h={50} size={14.5} disabled={!dirty || busy !== null} onPress={() => void sendUpdated()} />
        </View>
      </View>
    ) : (
      <View style={{ gap: 10 }}>
        {dirty ? (
          <Pill testID="confirm-all" label="Confirm interpretation" h={58} size={17} press={0.98} disabled={busy !== null} onPress={() => void confirmAll()} />
        ) : (
          <Pill testID="view-incident" label="View incident" h={58} size={17} onPress={close} />
        )}
        <Pill testID="edit-toggle" label={editing ? 'Done editing' : 'Edit extracted details'} tone="soft" h={52} size={16} onPress={() => setEditing((e) => !e)} />
      </View>
    );

    return shell(
      <>
        {savedBanner}
        <Enter kind="fadeUp" duration={350} style={{ gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="check_circle" size={20} color={colors.greenText} filled />
            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.greenText }}>Analysis complete</Text>
          </View>
          <View style={{ marginTop: -6 }}>
            <Text accessibilityRole="header" style={{ fontSize: 30, fontWeight: '700', letterSpacing: -0.9, color: colors.ink }}>
              Incident understood
            </Text>
            <Text testID="result-meta" style={{ fontSize: 13, color: colors.gray1, marginTop: 2 }}>
              {phase.source === 'simulated' ? 'Simulated result' : `Ran on this device in ${phase.latencyMs} ms`} · a proposal until you confirm it
            </Text>
          </View>

          {editing ? null : (
            <View style={{ gap: 12 }}>
              <View testID="result-hero" style={{ backgroundColor: '#FFFFFF', borderRadius: 28, padding: 20, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                <View style={{ width: 62, height: 62, borderRadius: 20, backgroundColor: colors.coralTint, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="emergency" size={32} color={colors.coral} filled />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 13, fontWeight: '500', color: colors.gray1 }}>Incident</Text>
                  <Text testID="proposal-incidentType" style={{ fontSize: 24, lineHeight: 27.6, fontWeight: '800', letterSpacing: -0.8, color: colors.ink }}>
                    {type}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                    <Icon name="location_on" size={16} color={colors.gray2} />
                    <Text testID="proposal-building" style={{ flex: 1, fontSize: 14, color: colors.gray2 }}>
                      {building} · {floor}
                    </Text>
                  </View>
                </View>
              </View>
              <View style={{ backgroundColor: '#FFFFFF', borderRadius: 22, overflow: 'hidden' }}>
                {CARD_FIELDS.map((field, i) => {
                  const tag = tagOf(field);
                  return (
                    <View
                      key={field}
                      testID={`proposal-${field}`}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ fontSize: 12, color: colors.gray1 }}>{FIELD_LABELS[field]}</Text>
                        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink, marginTop: 1 }}>{shown(field)}</Text>
                      </View>
                      <TagPill label={tag.label} fg={tag.fg} bg={tag.bg} />
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {showClar && clarification ? (
            <Enter testID="clarification-card" kind="popIn" duration={400} ease="spring" style={{ backgroundColor: '#FFFFFF', borderRadius: 24, borderWidth: 1, borderColor: '#E1E3F2', padding: 18, gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="auto_awesome" size={16} color={colors.indigo} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.indigo }}>Suggested by AI · Missing context</Text>
              </View>
              <Text style={{ fontSize: 21, fontWeight: '800', letterSpacing: -0.6, color: colors.ink }}>One more detail could help.</Text>
              <Text style={{ fontSize: 16, color: colors.gray3 }}>“{clarification.question}”</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {clarification.field === 'floor'
                  ? FLOOR_ANSWERS.map((v) => <ChoiceChip key={v} testID={`clarification-quick-${v}`} label={v} onPress={() => void answerQuestion(v)} />)
                  : null}
                <ChoiceChip testID="clarification-type" label="Type answer" onPress={() => setTyping(true)} />
                <ChoiceChip testID="clarification-skip" label="Skip for now" ghost onPress={() => void skipQuestion()} />
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
                    onSubmitEditing={() => void answerQuestion(answer)}
                    style={{ flex: 1, minWidth: 0, minHeight: 44, borderRadius: 13, borderWidth: 1, borderColor: colors.lineInput, backgroundColor: '#FAFAFB', paddingHorizontal: 14, fontSize: 16, color: colors.ink }}
                  />
                  <Pill testID="clarification-submit" label="Add" h={44} size={15} px={18} disabled={busy !== null || answer.trim().length === 0} onPress={() => void answerQuestion(answer)} />
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="check_circle" size={15} color={colors.gray1} />
                <Text style={{ flex: 1, fontSize: 12, color: colors.gray1 }}>Your SOS is already saved. Answering is optional.</Text>
              </View>
            </Enter>
          ) : null}
          {clarification && clarState !== 'open' ? (
            <View testID="clarification-note" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
              <Icon name="info" size={17} color={clarState === 'skipped' ? colors.amberText : colors.greenText} />
              <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: clarState === 'skipped' ? colors.amberText : colors.greenText }}>
                {clarState === 'skipped' ? `${clarLabel} kept as unknown. You can add it later.` : `${clarLabel} confirmed by you.`}
              </Text>
            </View>
          ) : null}

          {editing ? (
            <View style={{ backgroundColor: '#FFFFFF', borderRadius: 24, padding: 16, gap: 12 }}>
              {PROPOSAL_FIELDS.map((field) => (
                <View key={field} style={{ gap: 6 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: colors.gray1 }}>{FIELD_LABELS[field]}</Text>
                  <TextInput
                    testID={`edit-${field}`}
                    accessibilityLabel={FIELD_LABELS[field]}
                    value={values[field] ?? ''}
                    onChangeText={(v) => setValues((s) => ({ ...s, [field]: v }))}
                    placeholder="Unknown"
                    placeholderTextColor={colors.gray4}
                    maxLength={120}
                    style={{ minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: colors.lineInput, backgroundColor: '#FAFAFB', paddingHorizontal: 14, fontSize: 16, color: colors.ink }}
                  />
                </View>
              ))}
            </View>
          ) : null}

          <View style={{ backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16 }}>
            <Pressable
              testID="toggle-evidence"
              accessibilityRole="button"
              accessibilityState={{ expanded: evidenceOpen }}
              onPress={() => setEvidenceOpen((o) => !o)}
              hitSlop={12}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>How {BRAND} understood this</Text>
              <Icon name={evidenceOpen ? 'expand_less' : 'expand_more'} size={22} />
            </Pressable>
            {evidenceOpen ? (
              <Enter kind="fadeUp" duration={300} style={{ marginTop: 12, gap: 10 }}>
                <View style={{ backgroundColor: colors.page, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 }}>
                  <Text testID="evidence-report" style={{ fontSize: 14, lineHeight: 20.3, color: colors.ink }}>
                    “{text.trim()}”
                  </Text>
                </View>
                <View>
                  {PROPOSAL_FIELDS.map((field) => {
                    const tag = tagOf(field);
                    const original = proposal.fields[field];
                    return (
                      <View key={field} testID={`evidence-${field}`} style={{ paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: colors.ink }}>
                            {FIELD_LABELS[field]} · {shown(field)}
                          </Text>
                          <TagPill small label={tag.label} fg={tag.fg} bg={tag.bg} />
                        </View>
                        <Text style={{ fontSize: 12.5, fontStyle: 'italic', color: colors.gray1, marginTop: 3 }}>{original ? `“${original.evidence}”` : 'Not mentioned in the report'}</Text>
                      </View>
                    );
                  })}
                </View>
                {proposal.dropped.length > 0 ? (
                  <Text testID="evidence-dropped" style={{ fontSize: 12.5, lineHeight: 17.5, color: colors.gray1 }}>
                    Discarded because your words did not support it: {proposal.dropped.map((f) => FIELD_LABELS[f].toLowerCase()).join(', ')}.
                  </Text>
                ) : null}
              </Enter>
            ) : null}
          </View>

          <Banner testID="ai-warning" icon="warning" text="AI interpretation may be inaccurate. Review details before sending." />
          {confirmedOnce ? (
            <Enter kind="popIn" duration={300}>
              <Banner testID="confirmed-banner" tone="green" icon="lock" filled weight="600" text={`Confirmed details are recorded on ${view.shortId}. Recipients read them only at the level you approved.`} />
            </Enter>
          ) : null}
        </Enter>
      </>,
      footer,
    );
  }

  const canSubmit = text.trim().length > 0;
  const micLabel =
    voice.k === 'recording'
      ? demo
        ? 'Listening… (simulated)'
        : 'Listening… tap to stop'
      : voice.k === 'starting'
        ? 'Starting…'
        : voice.k === 'transcribing'
          ? 'Transcribing on this device…'
          : text.length > 0 && inputMode === 'transcribed'
            ? 'Recording captured · check the text below'
            : 'Tap to record a voice report';

  return shell(
    <>
      {savedBanner}
      <Enter kind="fadeUp" duration={300} style={{ gap: 16 }}>
        {heading('Describe what happened', 'Your report is interpreted on this device. Nothing is uploaded.')}
        {caps && !textReady ? (
          <Banner
            testID="ai-basic"
            roomy
            text={`The on-device model is ${presentAIState(caps.text.state).label.toLowerCase()} on this iPhone. Your report will be sent as written. Manual SOS is unaffected.`}
          />
        ) : null}
        {notSaved ? <Banner testID="report-not-saved" tone="coral" icon="error" weight="500" text="Your report could not be saved on this device. Your request itself is still saved. Try again." /> : null}
        {voice.k === 'failed' ? <Banner testID="voice-failed" roomy text={voice.message} /> : null}

        <SegmentedControl options={INPUT_MODES} value={mode} onChange={setMode} accessibilityLabel="How to describe it" height={36} radius={13} itemRadius={10} fontSize={14} />

        {mode === 'voice' ? (
          <View style={{ backgroundColor: '#FFFFFF', borderRadius: 28, paddingVertical: 28, paddingHorizontal: 20, alignItems: 'center', gap: 16 }}>
            <View style={{ width: 110, height: 110 }}>
              <PulseRing size={110} color={colors.coral} active={voice.k === 'recording'} durationMs={1400} />
              <Pressable
                testID="mic"
                accessibilityRole="button"
                accessibilityLabel={voice.k === 'recording' ? 'Stop recording' : 'Record'}
                accessibilityHint="Asks for the microphone only when you tap"
                accessibilityState={{ busy: voice.k === 'starting' || voice.k === 'transcribing' }}
                onPress={() => void onMic()}
                style={{ position: 'absolute', left: 0, top: 0, width: 110, height: 110, borderRadius: 55, alignItems: 'center', justifyContent: 'center', backgroundColor: voice.k === 'recording' ? colors.coral : colors.ink }}>
                <Icon name={voice.k === 'recording' ? 'graphic_eq' : 'mic'} size={40} color="#FFFFFF" filled />
              </Pressable>
            </View>
            {voice.k === 'recording' ? <WaveBars /> : null}
            <Text accessibilityLiveRegion="polite" style={{ fontSize: 14, fontWeight: '500', color: colors.gray1, textAlign: 'center' }}>
              {micLabel}
            </Text>
            {text.length > 0 && voice.k !== 'recording' ? (
              <Enter kind="fadeUp" duration={300} style={{ alignSelf: 'stretch', backgroundColor: colors.page, borderRadius: 16, padding: 14 }}>
                <Text testID="voice-text" style={{ fontSize: 15, lineHeight: 21.75, color: colors.ink }}>
                  “{text}”
                </Text>
              </Enter>
            ) : null}
            <Text style={{ fontSize: 12, lineHeight: 17, color: colors.gray1, textAlign: 'center' }}>
              Voice is best-effort. Transcription runs on this device for {snapshot.settings.reportLocale} and may be unavailable; you can always type.
            </Text>
          </View>
        ) : (
          <View style={{ backgroundColor: '#FFFFFF', borderRadius: 24, padding: 16 }}>
            <TextInput
              testID="report-input"
              accessibilityLabel="What happened"
              value={text}
              onChangeText={(v) => {
                setText(v);
                if (inputMode === 'transcribed' && v.trim().length === 0) setInputMode('typed');
              }}
              placeholder="What happened? Where are you?"
              placeholderTextColor={colors.gray4}
              multiline
              textAlignVertical="top"
              style={{ minHeight: 140, fontSize: 16, lineHeight: 23.2, color: colors.ink, padding: 0 }}
            />
            {inputMode === 'transcribed' ? <Text style={{ fontSize: 12.5, color: colors.gray1, marginTop: 6 }}>Transcribed on this device. Check it and correct anything before sending.</Text> : null}
            {demo ? (
              <View style={{ alignSelf: 'flex-start', marginTop: 8 }}>
                <Pill testID="use-sample" label="Use sample report (Filipino)" tone="soft" h={34} size={13} px={12} icon="translate" iconSize={16} onPress={() => setText(SAMPLE)} />
              </View>
            ) : null}
          </View>
        )}
      </Enter>
    </>,
    textReady ? (
      <Pill testID="report-submit" label="Analyze locally" h={58} size={17} icon="auto_awesome" iconSize={20} disabled={!canSubmit} onPress={() => void submit()} />
    ) : (
      <Pill testID="report-submit" label="Send as text report" h={58} size={17} disabled={!canSubmit} onPress={() => void submit()} />
    ),
  );
}
