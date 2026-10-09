import { router } from 'expo-router';
import { useState } from 'react';
import { Share, Text, View } from 'react-native';

import { PROPOSAL_FIELDS, type AIResult, type IncidentProposal, type OutputProbeLine } from '@/ai';
import type { EvaluationOutcome } from '@/services/api';
import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Banner, Button, Card, ChoiceChip, GroupedList, MicroPill, Screen, SectionHeader, TextField } from '@/ui';

import { routes } from '../nav';
import { FIELD_LABELS, presentAIState } from '../present';
import { CapabilityRows } from './CapabilityRows';

const EVAL_SPLITS = [
  { id: 'development', label: 'Development' },
  { id: 'validation', label: 'Validation' },
  { id: 'held_out', label: 'Held-out' },
] as const;

const EVAL_VARIANTS = [
  { id: 'staged', label: 'Staged' },
  { id: 'single', label: 'Single call' },
  { id: 'quotes', label: 'Extract: phrases' },
  { id: 'nested', label: 'Extract: value + evidence' },
] as const;

/**
 * Diagnostics for the on-device provider, through the service contract only. Extraction runs either
 * on a report already stored on this device or on typed text; both show a proposal and neither
 * creates, records or sends anything. A simulated result is labelled and its latency is not shown.
 */
export function LocalAIDiagnosticsScreen() {
  const snapshot = usePulse();
  const actions = usePulseActions();
  const caps = snapshot.capabilities;
  const demo = snapshot.mode === 'demo';
  const [picked, setPicked] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AIResult<IncidentProposal> | null>(null);
  const [probe, setProbe] = useState<OutputProbeLine[] | null>(null);
  const [split, setSplit] = useState<(typeof EVAL_SPLITS)[number]['id']>('development');
  const [variant, setVariant] = useState<(typeof EVAL_VARIANTS)[number]['id']>('staged');
  const [conditions, setConditions] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<EvaluationOutcome | null>(null);

  const stored = snapshot.incidents.flatMap((view) =>
    view.originalReport === null ? [] : view.state.reports.filter((r) => r.kind === 'report').map((r) => ({ key: `${view.id}:${r.id}`, incidentId: view.id, reportId: r.id, label: view.shortId })),
  );
  const target = stored.find((s) => s.key === picked) ?? stored[0] ?? null;
  const textReady = caps?.text.state === 'ready';
  const back = () => (router.canGoBack() ? router.back() : router.replace(routes.demoLab));

  const runStored = async () => {
    if (!target) return;
    setRunning(true);
    setResult(null);
    // Report text and model output are shown on screen only and never logged.
    setResult(await actions.analyzeReport(target.incidentId, target.reportId));
    setRunning(false);
  };

  const runFreeText = async () => {
    const body = text.trim();
    if (body.length === 0) return;
    setRunning(true);
    setResult(null);
    setResult(await actions.diagnoseExtraction(body));
    setRunning(false);
  };

  const runProbe = async () => {
    setRunning(true);
    setProbe(null);
    setProbe(await actions.probeLocalAI());
    setRunning(false);
  };

  const share = async (fileUri: string) => {
    try {
      await Share.share({ url: fileUri });
    } catch {
      // Closing the share sheet is not an error; the file stays where it is for another try.
    }
  };

  const runEvaluation = async () => {
    setRunning(true);
    setOutcome(null);
    setProgress({ done: 0, total: 0 });
    const finished = await actions.runEvaluation({ split, variant, conditions }, (done, total) => setProgress({ done, total }));
    setOutcome(finished);
    setProgress(null);
    setRunning(false);
    if (finished.ok) await share(finished.fileUri);
  };

  const simulated = result?.meta.source === 'simulated';
  const names = (fields: readonly (typeof PROPOSAL_FIELDS)[number][]) => fields.map((f) => FIELD_LABELS[f]).join(', ') || 'none';

  return (
    <Screen testID="local-ai-screen" onBack={back} title="Local AI diagnostics" subtitle={demo ? 'Demo mode: results on this screen are simulated.' : 'Real on-device calls. Nothing on this screen is simulated.'}>
      <View>
        <SectionHeader title="This iPhone" />
        <GroupedList>
          <View className="gap-1 px-4 py-3">
            <Text className="text-[13px] font-semibold text-gray-1">Device</Text>
            <Text testID="diag-device" className="text-[16px] text-ink">
              {caps ? `${caps.device.model} · iOS ${caps.device.osVersion}` : 'Checking…'}
            </Text>
            <Text className="mt-1 text-[13px] font-semibold text-gray-1">Provider</Text>
            <Text testID="diag-provider" className="text-[16px] text-ink">
              {caps ? `${caps.provider}${caps.source === 'simulated' ? '' : ` · @react-native-ai/apple ${caps.packageVersion}`}` : '—'}
            </Text>
          </View>
          {caps ? (
            <View className="border-t border-hairline">
              <CapabilityRows caps={caps} />
            </View>
          ) : null}
        </GroupedList>
        <View className="mt-2">
          <Button testID="diag-refresh" label="Check capabilities again" size="sm" variant="secondary" icon="replay" onPress={() => void actions.refreshCapabilities()} />
        </View>
      </View>
      {caps && !textReady ? <Banner testID="diag-unavailable" text={`The on-device language model is ${presentAIState(caps.text.state).label.toLowerCase()} on this iPhone. Manual SOS does not depend on it.`} /> : null}

      <View className="gap-2">
        <SectionHeader title="Extract from a stored report" />
        {stored.length === 0 ? (
          <Text testID="diag-no-report" className="px-1 text-[13.5px] leading-[19px] text-gray-1">
            No report is stored on this device yet. Send a request and describe what happened, then come back.
          </Text>
        ) : (
          <View className="flex-row flex-wrap gap-2">
            {stored.map((s) => (
              <ChoiceChip key={s.key} label={s.label} selected={target?.key === s.key} onPress={() => setPicked(s.key)} />
            ))}
          </View>
        )}
        <Button testID="diag-run" label={running ? 'Running on device…' : 'Extract on device'} icon="auto_awesome" disabled={running || target === null} onPress={() => void runStored()} />
        <Text className="px-1 text-[12.5px] leading-[17px] text-gray-1">Runs the model again on words already saved here. The result is shown below and nothing is recorded.</Text>
      </View>

      <View className="gap-2">
        <SectionHeader title="Extract from typed text" />
        <TextField testID="diag-text" label="Test report" placeholder="What happened? Where are you?" value={text} onChangeText={setText} multiline maxLength={4000} />
        <Button testID="diag-run-text" label="Extract from this text" variant="secondary" disabled={running || text.trim().length === 0} onPress={() => void runFreeText()} />
        <Text testID="diag-text-note" className="px-1 text-[12.5px] leading-[17px] text-gray-1">
          Runs the model on the text above. Nothing is saved or sent, and no request is created.
        </Text>
      </View>

      {demo ? null : (
        <View className="gap-2">
          <SectionHeader title="Output shape probe" />
          <Button testID="diag-probe" label={running ? 'Running on device…' : 'Run output probe'} variant="secondary" disabled={running || !textReady} onPress={() => void runProbe()} />
          <Text className="px-1 text-[12.5px] leading-[17px] text-gray-1">
            Sends one built-in test sentence through each output shape, one at a time. It uses no report from this device, and nothing is saved or sent.
          </Text>
          {probe ? (
            <Card className="gap-2">
              {probe.length === 0 ? (
                <Text testID="diag-probe-empty" className="text-[13px] text-gray-1">
                  No on-device provider is loaded, so nothing was run.
                </Text>
              ) : (
                probe.map((p) => (
                  <View key={p.variant} testID="diag-probe-line" className="gap-0.5">
                    <Text className="text-[14px] font-semibold text-ink">
                      {p.ok ? 'Returned' : 'Failed'} · {p.variant} · {p.latencyMs} ms
                    </Text>
                    <Text selectable className="text-[12.5px] leading-[17px] text-gray-1">
                      {p.detail}
                    </Text>
                  </View>
                ))
              )}
            </Card>
          ) : null}
        </View>
      )}

      {demo ? null : (
        <View className="gap-2">
          <SectionHeader title="Evaluation run" />
          <Text className="px-1 text-[12.5px] leading-[17px] text-gray-1">
            Runs built-in synthetic scenarios through the on-device pipeline, in memory, and exports the outputs and timings as one file for scoring on the Mac. It creates no request and sends nothing. Answers are not on this phone.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {EVAL_SPLITS.map((o) => (
              <ChoiceChip key={o.id} label={o.label} selected={split === o.id} onPress={() => setSplit(o.id)} />
            ))}
          </View>
          <View className="flex-row flex-wrap gap-2">
            {EVAL_VARIANTS.map((o) => (
              <ChoiceChip key={o.id} label={o.label} selected={variant === o.id} onPress={() => setVariant(o.id)} />
            ))}
          </View>
          <TextField testID="diag-eval-conditions" label="Test conditions" placeholder="Airplane mode on, phone language English…" value={conditions} onChangeText={setConditions} maxLength={300} />
          <Button
            testID="diag-eval-run"
            label={progress ? (progress.total > 0 ? `Running ${progress.done} of ${progress.total}…` : 'Starting…') : 'Run and export'}
            icon="auto_awesome"
            disabled={running || !textReady}
            onPress={() => void runEvaluation()}
          />
          {outcome ? (
            <Card className="gap-2">
              <Text testID="diag-eval-outcome" accessibilityLiveRegion="polite" className="text-[14px] font-semibold text-ink">
                {outcome.ok
                  ? `${outcome.scenarios} scenarios · ${outcome.calls} model calls · ${outcome.failedCalls} failed`
                  : outcome.reason === 'busy'
                    ? 'A run is already in progress.'
                    : outcome.reason === 'export_failed'
                      ? 'The run finished but the file could not be written.'
                      : 'Evaluation needs the on-device provider on a physical iPhone.'}
              </Text>
              {outcome.ok ? (
                <>
                  <Text selectable className="text-[12.5px] text-gray-1">
                    {outcome.fileName}
                  </Text>
                  <Button testID="diag-eval-share" label="Share the result file" size="sm" variant="secondary" onPress={() => void share(outcome.fileUri)} />
                </>
              ) : null}
            </Card>
          ) : null}
        </View>
      )}

      {result ? (
        <View testID="diag-result">
          <Card className="gap-2">
            {simulated ? <MicroPill label="SIMULATED" /> : null}
            <Text testID="diag-result-meta" accessibilityLiveRegion="polite" className="text-[13px] font-semibold text-gray-1">
              {result.ok ? 'Proposal' : `Failed: ${result.state}`} · {simulated ? 'simulated, not measured' : `${result.meta.latencyMs} ms · ${result.meta.source}`}
            </Text>
            {result.ok ? (
              <>
                {PROPOSAL_FIELDS.map((name) => {
                  const f = result.value.fields[name];
                  return f ? (
                    <View key={name} testID={`diag-field-${name}`} className="gap-0.5">
                      <Text className="text-[15px] font-semibold text-ink">
                        {FIELD_LABELS[name]}: {f.value}
                      </Text>
                      <Text className="text-[13px] italic text-gray-1">“{f.evidence}”</Text>
                    </View>
                  ) : null;
                })}
                <Text testID="diag-unknown" className="text-[13px] text-gray-1">
                  Unknown: {names(result.value.unknown)}
                </Text>
                <Text testID="diag-dropped" className="text-[13px] text-gray-1">
                  Dropped (no evidence in report): {names(result.value.dropped)}
                </Text>
              </>
            ) : (
              <>
                <Text testID="diag-result-state" className="text-[15px] font-semibold text-ink">
                  {presentAIState(result.state).label}. No proposal was produced.
                </Text>
                <Text selectable className="text-[13px] text-gray-1">
                  {result.message}
                </Text>
              </>
            )}
            <Text testID="diag-result-note" className="text-[12.5px] leading-[17px] text-gray-1">
              {result.ok ? 'A proposal, not a fact. Nothing was saved or sent.' : 'Nothing was saved or sent.'}
            </Text>
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}
