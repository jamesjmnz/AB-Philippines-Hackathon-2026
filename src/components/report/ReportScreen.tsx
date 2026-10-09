import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { PROPOSAL_FIELDS, type AIFailureState, type AISource, type ClarificationProposal, type IncidentProposal, type ProposalField } from '@/ai';
import { canAddReport } from '@/domain';
import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Banner, Button, Chip, Icon, MicroPill, PulseRing, Screen, SegmentedControl, TextField, colors } from '@/ui';

import { useActor } from '../incident/useMe';
import { useRun } from '../incident/useRun';
import { routes } from '../nav';
import { FIELD_LABELS, presentAIState, PROVENANCE } from '../present';
import { startRecording, type Recording } from './voice';

type Phase =
  | { k: 'input' }
  | { k: 'saving' }
  | { k: 'analyzing' }
  | { k: 'result'; reportId: string; proposal: IncidentProposal; source: AISource; latencyMs: number }
  | { k: 'unavailable'; reason: AIFailureState }
  | { k: 'not_saved' };

type Voice = { k: 'idle' } | { k: 'starting' } | { k: 'recording' } | { k: 'transcribing' } | { k: 'failed'; message: string };

const INPUT_MODES = [
  { key: 'type', label: 'Type' },
  { key: 'voice', label: 'Voice · best effort' },
] as const;

/** Local AI analysis of an optional report. The SOS already exists before this screen opens. */
export function ReportScreen({ incidentId }: { incidentId: string }) {
  const snapshot = usePulse();
  const actions = usePulseActions();
  const actor = useActor();
  const { busy, run } = useRun();
  const view = snapshot.incidents.find((i) => i.id === incidentId);
  const caps = snapshot.capabilities;
  const textReady = caps?.text.state === 'ready';

  const [mode, setMode] = useState<'type' | 'voice'>('type');
  const [text, setText] = useState('');
  const [inputMode, setInputMode] = useState<'typed' | 'transcribed'>('typed');
  const [phase, setPhase] = useState<Phase>({ k: 'input' });
  const [voice, setVoice] = useState<Voice>({ k: 'idle' });
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Partial<Record<ProposalField, string>>>({});
  const [confirmed, setConfirmed] = useState<ProposalField[]>([]);
  const [clarification, setClarification] = useState<ClarificationProposal>(null);
  const [clarState, setClarState] = useState<'open' | 'answered' | 'skipped'>('open');
  const [answer, setAnswer] = useState('');
  const recording = useRef<Recording | null>(null);
  const attached = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void recording.current?.stop();
    };
  }, []);

  // Returns to the incident if it is already in the stack, otherwise replaces this screen with it.
  const close = () => router.dismissTo(routes.incident(incidentId));

  const submit = async () => {
    const body = text.trim();
    if (body.length === 0 || phase.k === 'saving' || phase.k === 'analyzing') return;
    setPhase({ k: 'saving' });
    let saved: Awaited<ReturnType<typeof actions.addReport>>;
    try {
      saved = await actions.addReport(incidentId, body, inputMode);
    } catch {
      saved = { ok: false, code: 'unexpected', message: '' };
    }
    if (!alive.current) return;
    if (!saved.ok) {
      setPhase({ k: 'not_saved' });
      return;
    }
    const reportId = saved.value.reportId;
    setPhase({ k: 'analyzing' });
    const result = await actions.analyzeReport(incidentId, reportId);
    if (!alive.current) return;
    if (!result.ok) {
      setPhase({ k: 'unavailable', reason: result.state });
      return;
    }
    const initial: Partial<Record<ProposalField, string>> = {};
    for (const field of PROPOSAL_FIELDS) {
      const f = result.value.fields[field];
      if (f) initial[field] = f.value;
    }
    setValues(initial);
    setPhase({ k: 'result', reportId, proposal: result.value, source: result.meta.source, latencyMs: result.meta.latencyMs });
    const question = await actions.suggestClarification(incidentId);
    if (alive.current && question.ok) setClarification(question.value);
  };

  const ensureAttached = async (): Promise<boolean> => {
    if (phase.k !== 'result') return false;
    if (attached.current) return true;
    const r = await run('attach', () => actions.attachProposal(incidentId, phase.reportId, phase.proposal));
    if (r.ok) attached.current = true;
    return r.ok;
  };

  const confirm = async (fields: readonly ProposalField[]) => {
    if (!(await ensureAttached())) return;
    for (const field of fields) {
      const value = values[field]?.trim();
      if (!value || confirmed.includes(field)) continue;
      const r = await run(`confirm-${field}`, () => actions.confirmFact(incidentId, field, value));
      if (!r.ok) return;
      setConfirmed((c) => (c.includes(field) ? c : [...c, field]));
    }
  };

  const finish = async () => {
    if (phase.k === 'result') await ensureAttached();
    close();
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
      }
      setMode('type');
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
    setVoice({ k: 'recording' });
  };

  const badge = (
    <View className="max-w-[230px] flex-row items-center gap-1.5 rounded-full bg-card px-3 py-[6px]">
      <Icon name="memory" size={16} />
      <Text numberOfLines={1} className="text-[12px] font-semibold text-ink">
        {caps ? `${caps.provider} · on this device` : 'Local AI · checking'}
      </Text>
    </View>
  );

  if (!view) {
    return (
      <Screen onBack={() => router.replace(routes.home)} title="Request not found" subtitle="This request is not on this device.">
        <View />
      </Screen>
    );
  }

  const mayReport = canAddReport(view.state, actor, 'report').ok;
  if (!mayReport && phase.k === 'input') {
    return (
      <Screen onBack={close} title="Report unavailable" subtitle={view.state.closure ? 'This request is closed, so no report can be added.' : 'Only the requester can add the report. You can add an observation from the request.'}>
        <Button label="View incident" onPress={close} />
      </Screen>
    );
  }

  const savedBanner = <Banner testID="saved-banner" tone="coral" icon="sos" text="Your request is already saved on this device. Describing it is optional and does not delay it." />;

  if (phase.k === 'saving' || phase.k === 'analyzing') {
    return (
      <Screen testID="report-screen" headerRight={badge} onBack={close}>
        {savedBanner}
        <View className="items-center gap-2 pt-4">
          <Text accessibilityRole="header" accessibilityLiveRegion="polite" className="text-[26px] font-extrabold tracking-[-0.8px] text-ink">
            {phase.k === 'saving' ? 'Saving your report' : 'Understanding locally'}
          </Text>
          <Text className="text-center text-[13px] text-gray-1">{caps ? `${caps.provider} · ${caps.device.model}` : 'On this device'}</Text>
        </View>
        <View className="overflow-hidden rounded-feature bg-card">
          {[
            { label: 'Report saved on this device', done: phase.k === 'analyzing' },
            { label: 'Reading it with the on-device model', done: false },
          ].map((s, i) => (
            <View key={s.label} className={`flex-row items-center gap-3 px-4 py-[15px] ${i === 0 ? '' : 'border-t border-hairline'}`}>
              <Icon name={s.done ? 'check_circle' : 'progress_activity'} size={22} color={s.done ? colors.green : colors.gray4} filled={s.done} />
              <Text className={`flex-1 text-[15px] font-semibold ${s.done ? 'text-ink' : 'text-gray-1'}`}>{s.label}</Text>
            </View>
          ))}
        </View>
        <Text className="text-center text-[12.5px] text-gray-1">Nothing is uploaded. If the model cannot answer, your original report is still attached.</Text>
      </Screen>
    );
  }

  if (phase.k === 'unavailable') {
    return (
      <Screen testID="report-screen" headerRight={badge} onBack={close} title="Report attached" footer={<Button testID="view-incident" label="View incident" onPress={close} />}>
        <Banner testID="ai-unavailable" text="Local AI unavailable — sending original report." />
        <View className="gap-2 rounded-card bg-card p-4">
          <Text className="text-[13px] font-semibold text-gray-1">On-device model</Text>
          <Text testID="ai-unavailable-reason" className="text-[16px] font-semibold text-ink">
            {presentAIState(phase.reason).label}
          </Text>
          <Text className="text-[13.5px] leading-[19px] text-gray-2">
            Your words are attached to the request exactly as you wrote them. No details were extracted and nothing was guessed. The request itself was already saved.
          </Text>
        </View>
        <View className="rounded-card bg-card p-4">
          <Text className="text-[12px] font-semibold text-gray-1">Your report</Text>
          <Text className="mt-1 text-[15px] leading-[22px] text-ink">“{text.trim()}”</Text>
        </View>
      </Screen>
    );
  }

  if (phase.k === 'result') {
    const proposed = PROPOSAL_FIELDS.filter((f) => phase.proposal.fields[f] !== undefined);
    const missing = PROPOSAL_FIELDS.filter((f) => phase.proposal.fields[f] === undefined);
    const unconfirmed = proposed.filter((f) => !confirmed.includes(f));
    return (
      <Screen
        testID="report-screen"
        headerRight={badge}
        onBack={() => void finish()}
        footer={
          <>
            {unconfirmed.length > 0 ? <Button testID="confirm-all" label="Confirm all" disabled={busy !== null} onPress={() => void confirm(unconfirmed)} /> : null}
            <View className="flex-row gap-[10px]">
              <View className="flex-1">
                <Button testID="edit-toggle" label={editing ? 'Done editing' : 'Edit'} variant="secondary" size="md" onPress={() => setEditing((e) => !e)} />
              </View>
              <View className="flex-1">
                <Button testID="view-incident" label="View incident" variant={unconfirmed.length > 0 ? 'secondary' : 'primary'} size="md" disabled={busy !== null} onPress={() => void finish()} />
              </View>
            </View>
          </>
        }>
        <View className="gap-1">
          <View className="flex-row items-center gap-2">
            <Icon name="auto_awesome" size={18} color={colors.indigo} />
            <Text className="flex-1 text-[14px] font-bold text-indigo">Proposal from the on-device model</Text>
            {phase.source === 'simulated' ? <MicroPill label="Simulated" /> : null}
          </View>
          <Text accessibilityRole="header" className="text-[30px] font-bold tracking-[-0.9px] text-ink">
            Check what was understood
          </Text>
          <Text className="text-[13px] text-gray-1">
            {phase.source === 'simulated' ? 'Simulated result' : `Ran on this device in ${phase.latencyMs} ms`} · your original report is attached either way
          </Text>
        </View>
        <Banner testID="ai-warning" icon="warning" text="AI interpretation may be inaccurate. Review details before confirming." />

        <View className="overflow-hidden rounded-card bg-card">
          {proposed.length === 0 ? (
            <View className="px-4 py-4">
              <Text testID="no-proposal" className="text-[14px] leading-[20px] text-gray-1">
                The model found nothing it could support with your words. Every detail stays unknown.
              </Text>
            </View>
          ) : null}
          {proposed.map((field, i) => {
            const original = phase.proposal.fields[field];
            const isConfirmed = confirmed.includes(field);
            const tag = isConfirmed ? PROVENANCE.user_confirmed : PROVENANCE.ai_proposed;
            return (
              <View key={field} testID={`proposal-${field}`} className={`gap-2 px-4 py-3 ${i === 0 ? '' : 'border-t border-hairline'}`}>
                <View className="flex-row items-start gap-3">
                  <View className="flex-1">
                    <Text className="text-[12px] text-gray-1">{FIELD_LABELS[field]}</Text>
                    {editing && !isConfirmed ? (
                      <View className="mt-1">
                        <TextField testID={`edit-${field}`} label={FIELD_LABELS[field]} value={values[field] ?? ''} onChangeText={(v) => setValues((s) => ({ ...s, [field]: v }))} maxLength={120} />
                      </View>
                    ) : (
                      <Text className="mt-[1px] text-[15px] font-semibold text-ink">{values[field] ?? ''}</Text>
                    )}
                    {original ? <Text className="mt-1 text-[12.5px] italic text-gray-1">From your words: “{original.evidence}”</Text> : null}
                  </View>
                  <Chip label={tag.label} tone={tag.tone} solid={tag.solid} />
                </View>
                {isConfirmed ? null : (
                  <Button testID={`confirm-${field}`} label="Confirm" size="sm" variant="secondary" disabled={busy !== null || (values[field] ?? '').trim().length === 0} onPress={() => void confirm([field])} />
                )}
              </View>
            );
          })}
          {missing.map((field) => (
            <View key={field} className="flex-row items-center gap-3 border-t border-hairline px-4 py-3">
              <View className="flex-1">
                <Text className="text-[12px] text-gray-1">{FIELD_LABELS[field]}</Text>
                <Text className="mt-[1px] text-[15px] font-semibold text-gray-1">Unknown</Text>
              </View>
              <Chip label={PROVENANCE.unknown.label} tone="gray" />
            </View>
          ))}
        </View>
        {phase.proposal.dropped.length > 0 ? (
          <Text className="px-1 text-[12.5px] leading-[17px] text-gray-1">
            Discarded because your words did not support it: {phase.proposal.dropped.map((f) => FIELD_LABELS[f].toLowerCase()).join(', ')}.
          </Text>
        ) : null}

        {clarification && clarState === 'open' ? (
          <View testID="clarification-card" className="gap-3 rounded-feature border border-indigo-line bg-card p-[18px]">
            <View className="flex-row items-center gap-1.5">
              <Icon name="auto_awesome" size={16} color={colors.indigo} />
              <Text className="text-[12px] font-bold text-indigo">Suggested by AI · Missing context</Text>
            </View>
            <Text className="text-[21px] font-extrabold tracking-[-0.6px] text-ink">One more detail could help.</Text>
            <Text className="text-[16px] leading-[22px] text-gray-3">“{clarification.question}”</Text>
            <TextField testID="clarification-answer" label="Your answer" placeholder="Type an answer" value={answer} onChangeText={setAnswer} />
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Button
                  testID="clarification-skip"
                  label="Skip"
                  size="sm"
                  variant="secondary"
                  disabled={busy !== null}
                  onPress={async () => {
                    const r = await run('skip', () => actions.skipClarification(incidentId, clarification.field));
                    if (r.ok) setClarState('skipped');
                  }}
                />
              </View>
              <View className="flex-1">
                <Button
                  testID="clarification-submit"
                  label="Add"
                  size="sm"
                  disabled={busy !== null || answer.trim().length === 0}
                  onPress={async () => {
                    const r = await run('answer', () => actions.answerClarification(incidentId, clarification.field, answer.trim()));
                    if (r.ok) setClarState('answered');
                  }}
                />
              </View>
            </View>
            <Text className="text-[12px] text-gray-1">Optional. Your request does not wait for this.</Text>
          </View>
        ) : null}
        {clarification && clarState !== 'open' ? (
          <Text accessibilityLiveRegion="polite" className="px-1 text-[13px] font-semibold text-gray-2">
            {clarState === 'answered' ? 'Your answer was recorded as your own statement.' : 'Skipped. That detail stays unknown.'}
          </Text>
        ) : null}

        <View className="rounded-card bg-card p-4">
          <Text className="text-[15px] font-bold text-ink">Your original report</Text>
          <Text className="mt-2 rounded-2xl bg-page px-[14px] py-3 text-[14px] leading-[20px] text-ink">“{text.trim()}”</Text>
        </View>
      </Screen>
    );
  }

  const canSubmit = text.trim().length > 0;
  return (
    <Screen
      testID="report-screen"
      headerRight={badge}
      onBack={close}
      title="Describe what happened"
      subtitle="Your report is interpreted on this device. Nothing is uploaded."
      footer={<Button testID="report-submit" label={textReady ? 'Analyze locally' : 'Send as text report'} icon={textReady ? 'auto_awesome' : undefined} disabled={!canSubmit} onPress={() => void submit()} />}>
      {savedBanner}
      {caps && !textReady ? <Banner testID="ai-basic" text={`The on-device model is ${presentAIState(caps.text.state).label.toLowerCase()} on this iPhone. Your report will be attached as written, without interpretation.`} /> : null}
      {phase.k === 'not_saved' ? <Banner testID="report-not-saved" tone="coral" icon="error" text="Your report could not be saved on this device. Your request itself is still saved. Try again." /> : null}
      {voice.k === 'failed' ? <Banner testID="voice-failed" text={voice.message} /> : null}

      <SegmentedControl options={INPUT_MODES} value={mode} onChange={setMode} accessibilityLabel="How to describe it" />

      {mode === 'voice' ? (
        <View className="items-center gap-4 rounded-hero bg-card px-5 py-7">
          <View className="h-[110px] w-[110px] items-center justify-center">
            <PulseRing size={110} color={colors.coral} active={voice.k === 'recording'} durationMs={1400} />
            <Pressable
              testID="mic"
              accessibilityRole="button"
              accessibilityLabel={voice.k === 'recording' ? 'Stop recording' : 'Record'}
              accessibilityHint="Asks for the microphone only when you tap"
              accessibilityState={{ busy: voice.k === 'starting' || voice.k === 'transcribing' }}
              onPress={() => void onMic()}
              className="h-[110px] w-[110px] items-center justify-center rounded-full active:scale-[0.97]"
              style={{ backgroundColor: voice.k === 'recording' ? colors.coral : colors.ink }}>
              <Icon name={voice.k === 'recording' ? 'stop' : 'mic'} size={40} color="#FFFFFF" filled />
            </Pressable>
          </View>
          <Text accessibilityLiveRegion="polite" className="text-center text-[14px] font-medium text-gray-1">
            {voice.k === 'recording' ? 'Recording · tap to stop' : voice.k === 'starting' ? 'Starting…' : voice.k === 'transcribing' ? 'Transcribing on this device…' : 'Tap to record'}
          </Text>
          <Text className="text-center text-[12.5px] leading-[17px] text-gray-1">
            Voice is best-effort. Transcription runs on this device for {snapshot.settings.reportLocale} and may be unavailable; you can always type.
          </Text>
        </View>
      ) : (
        <View className="gap-2 rounded-feature bg-card p-4">
          <TextField
            testID="report-input"
            label="What happened"
            placeholder="What happened? Where are you? Any language."
            value={text}
            onChangeText={(v) => {
              setText(v);
              if (inputMode === 'transcribed' && v.trim().length === 0) setInputMode('typed');
            }}
            multiline
          />
          {inputMode === 'transcribed' ? <Text className="text-[12.5px] text-gray-1">Transcribed on this device. Check it and correct anything before sending.</Text> : null}
        </View>
      )}
    </Screen>
  );
}
