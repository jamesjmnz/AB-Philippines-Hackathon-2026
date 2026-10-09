import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import type { AppMode, DemoDevice } from '@/services/api';
import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Avatar, Banner, Button, GroupedList, Icon, ListRow, Screen, SectionHeader, SegmentedControl, Toggle, colors } from '@/ui';

import { useAppMode } from '../appMode';
import { routes } from '../nav';

const MODES = [
  { key: 'live', label: 'Live' },
  { key: 'demo', label: 'Demo' },
] as const;

const DEVICES: readonly { key: DemoDevice; name: string; role: string }[] = [
  { key: 'alex', name: 'Alex', role: 'Requester' },
  { key: 'mika', name: 'Mika', role: 'Responder · can see everything' },
  { key: 'noah', name: 'Noah', role: 'Responder · can see summary' },
];

export function DemoLabScreen() {
  const snapshot = usePulse();
  const actions = usePulseActions();
  const requested = useAppMode((s) => s.mode);
  const setMode = useAppMode((s) => s.setMode);
  const demo = snapshot.demo;
  const back = () => (router.canGoBack() ? router.back() : router.replace(routes.settings));

  return (
    <Screen testID="demo-lab-screen" onBack={back} title="PULSE Demo Lab" subtitle="Presentation controls. In Demo, all data, AI output, encryption and networking are simulated and kept apart from live data.">
      <View className="gap-2">
        <SegmentedControl<AppMode> options={MODES} value={requested} onChange={setMode} accessibilityLabel="Live or Demo" />
        <Text testID="mode-note" accessibilityLiveRegion="polite" className="px-1 text-[12.5px] leading-[17px] text-gray-1">
          {snapshot.mode === 'demo' ? 'Demo is on. The SIMULATED bar stays on every screen until you switch back to Live.' : 'Live is on. Only measured state from this iPhone is shown.'}
        </Text>
      </View>

      <GroupedList>
        <ListRow first testID="open-local-ai" icon="memory" title="Local AI diagnostics" subtitle="Capability matrix and an extraction run on this device" onPress={() => router.push(routes.localAI)} />
      </GroupedList>

      {demo === null ? (
        <Banner testID="demo-off" tone="gray" text="Scenario controls appear after you switch to Demo. Switching does not touch your live requests or pairings." />
      ) : (
        <>
          <View>
            <SectionHeader title="View as" />
            <GroupedList>
              {DEVICES.map((d, i) => {
                const selected = demo.viewingAs === d.key;
                return (
                  <Pressable
                    key={d.key}
                    testID={`view-as-${d.key}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`View as ${d.name}, ${d.role}`}
                    onPress={() => actions.demo.viewAs(d.key)}
                    className={`min-h-[60px] flex-row items-center gap-3 px-4 py-3 ${i === 0 ? '' : 'border-t border-hairline'}`}>
                    <Avatar name={d.name} size={40} self={selected} />
                    <View className="flex-1">
                      <Text className="text-[15px] font-semibold text-ink">{d.name}</Text>
                      <Text className="mt-0.5 text-[12.5px] text-gray-1">{d.role}</Text>
                    </View>
                    {selected ? <Icon name="check_circle" size={22} color={colors.ink} filled /> : null}
                  </Pressable>
                );
              })}
            </GroupedList>
          </View>

          <View>
            <SectionHeader title="Simulation toggles" />
            <GroupedList>
              {(['mika', 'noah'] as const).map((d, i) => (
                <View key={d} className={`min-h-[52px] flex-row items-center gap-3 px-4 py-2 ${i === 0 ? '' : 'border-t border-hairline'}`}>
                  <Text className="flex-1 text-[15px] font-medium text-ink">Link Alex ↔ {d === 'mika' ? 'Mika' : 'Noah'}</Text>
                  <Toggle testID={`link-${d}`} label={`Simulated link to ${d === 'mika' ? 'Mika' : 'Noah'}`} value={demo.links[d]} onChange={(v) => actions.demo.setLink(d, v)} />
                </View>
              ))}
              <View className="min-h-[52px] flex-row items-center gap-3 border-t border-hairline px-4 py-2">
                <Text className="flex-1 text-[15px] font-medium text-ink">Simulated AI ready</Text>
                <Toggle testID="ai-ready" label="Simulated AI ready" value={demo.aiReady} onChange={(v) => actions.demo.setAIReady(v)} />
              </View>
            </GroupedList>
          </View>

          <View>
            <SectionHeader title="Scenario presets" />
            <View className="gap-2">
              {demo.scenarios.map((s, i) => {
                const running = demo.runningScenario === s.key;
                return (
                  <Pressable
                    key={s.key}
                    testID={`scenario-${s.key}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Run scenario ${i + 1}: ${s.title}. ${s.description}`}
                    accessibilityState={{ selected: running }}
                    onPress={() => actions.demo.runScenario(s.key)}
                    className={`flex-row items-center gap-3 rounded-[20px] border bg-card px-4 py-[14px] ${running ? 'border-ink' : 'border-card'}`}>
                    <View className={`h-8 w-8 items-center justify-center rounded-full ${running ? 'bg-ink' : 'bg-hairline'}`}>
                      <Text className={`text-[14px] font-bold ${running ? 'text-white' : 'text-ink'}`}>{i + 1}</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-[15px] font-semibold text-ink">{s.title}</Text>
                      <Text className="mt-0.5 text-[12.5px] leading-[17px] text-gray-1">{s.description}</Text>
                    </View>
                    <Icon name={running ? 'progress_activity' : 'play_arrow'} size={20} color={colors.gray5} />
                  </Pressable>
                );
              })}
              {demo.scenarios.length === 0 ? <Text className="px-1 text-[13px] text-gray-1">No scenarios are available in this build.</Text> : null}
            </View>
          </View>

          <Button testID="demo-reset" label="Reset Scenario" size="md" onPress={() => actions.demo.reset()} />
        </>
      )}
    </Screen>
  );
}
