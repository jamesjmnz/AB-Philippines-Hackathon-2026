import { Text, View } from 'react-native';

import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Pill, Sheet, colors } from '@/ui';

import { presentAIState } from '../present';

/**
 * Opened from Home → Overview → "On-Device Intelligence" and Settings → "Model availability".
 * Design sheet chrome (809–825 / 849–869) around measured facts: provider, device and one row per
 * capability. They are separate facts and are never merged into a single "AI ready" claim.
 */
export function IntelligenceSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { capabilities: caps } = usePulse();
  const actions = usePulseActions();
  const stateOf = (state: Parameters<typeof presentAIState>[0]) => {
    if (caps?.source === 'simulated') return state === 'ready' ? 'Simulation' : 'Simulation · off';
    return presentAIState(state).label;
  };
  const rows = caps
    ? [
        { key: 'provider', l: 'Provider', v: caps.provider },
        { key: 'device', l: 'Device', v: `${caps.device.model} · iOS ${caps.device.osVersion}` },
        { key: 'text', l: 'Text model', v: stateOf(caps.text.state) },
        { key: 'embeddings', l: `Embeddings (${caps.embeddings.language})`, v: stateOf(caps.embeddings.state) },
        { key: 'transcription', l: `Transcription (${caps.transcription.locale})`, v: stateOf(caps.transcription.state) },
        { key: 'speech', l: 'Speech', v: stateOf(caps.speech.state) },
      ]
    : [];
  return (
    <Sheet testID="intelligence-sheet" visible={visible} onClose={onClose}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.gray1 }}>{caps?.source === 'simulated' ? 'SIMULATED · no model is running' : 'Runs on this iPhone · no cloud model'}</Text>
      <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: '800', letterSpacing: -0.8, color: colors.ink, marginTop: 4 }}>
        On-Device Intelligence
      </Text>
      <View style={{ marginTop: 6 }}>
        {caps ? (
          rows.map((r) => (
            <View key={r.key} testID={`intelligence-${r.key}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
              <Text style={{ fontSize: 14.5, color: colors.gray1 }}>{r.l}</Text>
              <Text style={{ flex: 1, fontSize: 14.5, fontWeight: '600', color: colors.ink, textAlign: 'right' }}>{r.v}</Text>
            </View>
          ))
        ) : (
          <Text testID="intelligence-pending" style={{ fontSize: 14.5, color: colors.gray1, paddingVertical: 12 }}>
            Still checking this iPhone.
          </Text>
        )}
      </View>
      <View style={{ backgroundColor: colors.page, borderRadius: 16, padding: 14, marginTop: 16 }}>
        <Text testID="intelligence-sos-note" style={{ fontSize: 15, lineHeight: 21.75, color: colors.ink }}>
          Manual SOS works without it. A request is saved and queued whether or not any of these are ready.
        </Text>
      </View>
      <View style={{ gap: 10, marginTop: 20 }}>
        <Pill testID="intelligence-done" label="Done" h={54} size={16} onPress={onClose} />
        <Pill testID="intelligence-refresh" label="Check again" tone="soft" h={50} size={14} onPress={() => void actions.refreshCapabilities()} />
      </View>
    </Sheet>
  );
}
