import { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import type { AIResult, CapabilityMatrix, IncidentProposal } from '@/ai';
import { createCallstackAppleAI } from '@/ai/callstack';
import { Banner, Button, Card, Chip, Screen, SectionHeader } from '@/ui';

// Phase 1 spike screen: proves the Callstack Apple provider is linked and runs on this device.
// It moves to Settings > Demo Lab > Local AI once the tab layout exists.
export default function Diagnostics() {
  const ai = useMemo(() => createCallstackAppleAI(), []);
  const [caps, setCaps] = useState<CapabilityMatrix | null>(null);
  const [report, setReport] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AIResult<IncidentProposal> | null>(null);

  useEffect(() => {
    ai.inspectCapabilities().then(setCaps);
  }, [ai]);

  const run = async () => {
    setRunning(true);
    setResult(null);
    const r = await ai.extractIncidentReport({ text: report });
    // Timing and outcome only: report text and model output are never logged.
    console.log('[pulse:diag]', JSON.stringify({ ok: r.ok, latencyMs: r.meta.latencyMs, state: r.ok ? 'ready' : r.state }));
    setResult(r);
    setRunning(false);
  };

  const textReady = caps?.text.state === 'ready';

  return (
    <Screen title="Local AI diagnostics" subtitle="Real on-device calls. Nothing on this screen is simulated.">
      <Card className="gap-2">
        <Text className="text-[13px] font-semibold text-gray-1">Device</Text>
        <Text className="text-[16px] text-ink">{caps ? `${caps.device.model} · iOS ${caps.device.osVersion}` : 'Checking…'}</Text>
        <Text className="mt-1 text-[13px] font-semibold text-gray-1">Provider</Text>
        <Text className="text-[16px] text-ink">{caps ? `${caps.provider} · @react-native-ai/apple ${caps.packageVersion}` : '—'}</Text>
        {caps ? (
          <View className="mt-2 gap-2">
            <Row label="Text model" state={caps.text.state} />
            <Row label={`Embeddings (${caps.embeddings.language})`} state={caps.embeddings.state} />
            <Row label={`Transcription (${caps.transcription.locale})`} state={caps.transcription.state} />
            <Row label="Speech" state={caps.speech.state} />
          </View>
        ) : null}
      </Card>

      <View>
        <SectionHeader title="Type a new report" />
        <TextInput
          className="min-h-[96px] rounded-input border border-line-input bg-fill-input p-3 text-[16px] text-ink"
          multiline
          placeholder="What happened? Where are you?"
          value={report}
          onChangeText={setReport}
          accessibilityLabel="Test report"
        />
      </View>
      <Button label={running ? 'Running on device…' : 'Extract on device'} icon="auto_awesome" disabled={!textReady || running || report.trim().length === 0} onPress={run} />
      {caps && !textReady ? <Banner text="The on-device language model is unavailable on this iPhone. Manual SOS does not depend on it." /> : null}

      {result ? (
        <Card className="gap-2">
          <Text className="text-[13px] font-semibold text-gray-1">
            {result.ok ? 'Proposal' : `Failed: ${result.state}`} · {result.meta.latencyMs} ms · {result.meta.source}
          </Text>
          {result.ok ? (
            <>
              {Object.entries(result.value.fields).map(([name, f]) => (
                <View key={name} className="gap-0.5">
                  <Text className="text-[15px] font-semibold text-ink">
                    {name}: {f.value}
                  </Text>
                  <Text className="text-[13px] italic text-gray-1">“{f.evidence}”</Text>
                </View>
              ))}
              <Text className="text-[13px] text-gray-1">Unknown: {result.value.unknown.join(', ') || 'none'}</Text>
              <Text className="text-[13px] text-gray-1">Dropped (no evidence in report): {result.value.dropped.join(', ') || 'none'}</Text>
            </>
          ) : (
            <Text selectable className="text-[15px] text-ink">{result.message}</Text>
          )}
        </Card>
      ) : null}
    </Screen>
  );
}

function Row({ label, state }: { label: string; state: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-[15px] text-ink">{label}</Text>
      <Chip label={state.replace(/_/g, ' ')} tone={state === 'ready' ? 'green' : 'amber'} />
    </View>
  );
}
