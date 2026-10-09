import { Text, View } from 'react-native';

import type { CapabilityMatrix } from '@/ai';
import { Chip } from '@/ui';

import { presentAIState } from '../present';

/** One row per capability. They are independent facts and are never merged into one "AI ready" claim. */
export function CapabilityRows({ caps }: { caps: CapabilityMatrix }) {
  const rows = [
    { key: 'text', label: 'Text model', detail: 'Structures a typed report', status: caps.text },
    { key: 'embeddings', label: `Embeddings (${caps.embeddings.language})`, detail: 'Compares statements', status: caps.embeddings },
    { key: 'transcription', label: `Transcription (${caps.transcription.locale})`, detail: 'Voice reports, best effort', status: caps.transcription },
    { key: 'speech', label: 'Speech', detail: 'Reads text aloud', status: caps.speech },
  ];
  return (
    <View>
      {rows.map((r, i) => {
        const p = caps.source === 'simulated' ? { label: r.status.state === 'ready' ? 'Simulation' : 'Simulation · off', tone: 'gray' as const } : presentAIState(r.status.state);
        return (
          <View key={r.key} testID={`capability-${r.key}`} className={`flex-row items-center gap-3 px-4 py-3 ${i === 0 ? '' : 'border-t border-hairline'}`}>
            <View className="flex-1">
              <Text className="text-[15px] font-semibold text-ink">{r.label}</Text>
              <Text className="mt-0.5 text-[12.5px] text-gray-1">{r.status.detail && r.status.detail.length > 0 ? r.status.detail : r.detail}</Text>
            </View>
            <Chip label={p.label} tone={p.tone} />
          </View>
        );
      })}
    </View>
  );
}
