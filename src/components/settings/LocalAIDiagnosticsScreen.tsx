import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { PROPOSAL_FIELDS, type AIResult, type IncidentProposal } from '@/ai';
import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Banner, Button, Card, ChoiceChip, GroupedList, Screen, SectionHeader, TextField } from '@/ui';

import { routes } from '../nav';
import { FIELD_LABELS, presentAIState } from '../present';
import { CapabilityRows } from './CapabilityRows';

/**
 * Diagnostics for the on-device provider, through the service contract only. Live mode re-runs
 * extraction on a report already stored on this device (no side effects). Free text is offered in
 * Demo only, because the contract analyses stored reports and creating one needs an incident.
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
  const [note, setNote] = useState<string | null>(null);

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
    setNote(null);
    // Report text and model output are shown on screen only and never logged.
    setResult(await actions.analyzeReport(target.incidentId, target.reportId));
    setRunning(false);
  };

  const runFreeText = async () => {
    const body = text.trim();
    if (!demo || body.length === 0) return;
    setRunning(true);
    setResult(null);
    setNote(null);
    const sos = await actions.sendSOS();
    if (!sos.ok) {
      setNote('The simulated request could not be created.');
      setRunning(false);
      return;
    }
    const report = await actions.addReport(sos.value.incidentId, body, 'typed');
    if (!report.ok) {
      setNote('The simulated report could not be stored.');
      setRunning(false);
      return;
    }
    setResult(await actions.analyzeReport(sos.value.incidentId, report.value.reportId));
    setNote('A simulated request was created to hold this text. Reset the scenario in Demo Lab to remove it.');
    setRunning(false);
  };

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

      {demo ? (
        <View className="gap-2">
          <SectionHeader title="Type a new report (Demo only)" />
          <TextField testID="diag-text" label="Test report" placeholder="What happened? Where are you?" value={text} onChangeText={setText} multiline />
          <Button testID="diag-run-text" label="Extract from this text" variant="secondary" disabled={running || text.trim().length === 0} onPress={() => void runFreeText()} />
        </View>
      ) : null}

      {note ? <Text className="px-1 text-[12.5px] leading-[17px] text-gray-1">{note}</Text> : null}

      {result ? (
        <Card className="gap-2">
          <Text testID="diag-result-meta" accessibilityLiveRegion="polite" className="text-[13px] font-semibold text-gray-1">
            {result.ok ? 'Proposal' : `Failed: ${result.state}`} · {result.meta.latencyMs} ms · {result.meta.source}
          </Text>
          {result.ok ? (
            <>
              {PROPOSAL_FIELDS.map((name) => {
                const f = result.value.fields[name];
                return f ? (
                  <View key={name} className="gap-0.5">
                    <Text className="text-[15px] font-semibold text-ink">
                      {FIELD_LABELS[name]}: {f.value}
                    </Text>
                    <Text className="text-[13px] italic text-gray-1">“{f.evidence}”</Text>
                  </View>
                ) : null;
              })}
              <Text className="text-[13px] text-gray-1">Unknown: {result.value.unknown.join(', ') || 'none'}</Text>
              <Text className="text-[13px] text-gray-1">Dropped (no evidence in report): {result.value.dropped.join(', ') || 'none'}</Text>
            </>
          ) : (
            <Text selectable className="text-[15px] text-ink">
              {result.message}
            </Text>
          )}
        </Card>
      ) : null}
    </Screen>
  );
}
