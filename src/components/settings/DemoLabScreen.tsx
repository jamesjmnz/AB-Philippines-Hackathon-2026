import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AppMode, DemoDevice } from '@/services/api';
import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Avatar, Enter, Icon, IconButton, Pill, SegmentedControl, Toggle, colors, padBottom, type IconName } from '@/ui';

import { useAppMode } from '../appMode';
import { useSafetySession } from '../demo/safetySession';
import { routes } from '../nav';
import { BRAND, brand } from '../present';
import { Text } from '@/ui/Text';

const MODES = [
  { key: 'live', label: 'Live' },
  { key: 'demo', label: 'Demo' },
] as const;

/** The design's simulated phones (design P table, line 943). */
const DEVICES: readonly { key: DemoDevice; name: string; first: string; device: string; ai: string }[] = [
  { key: 'alex', name: 'Alex Rivera', first: 'Alex', device: 'iPhone 17 Pro Max', ai: 'Main local AI device' },
  { key: 'mika', name: 'Mika Santos', first: 'Mika', device: 'iPhone 14 Pro Max', ai: 'Trusted responder / relay' },
  { key: 'noah', name: 'Noah Cruz', first: 'Noah', device: 'iPhone 13', ai: 'Trusted responder / relay' },
];

function SectionTitle({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" style={{ fontSize: 13, fontWeight: '600', color: colors.gray1, paddingHorizontal: 6, paddingBottom: 8 }}>
      {children}
    </Text>
  );
}

function Group({ children }: { children: ReactNode }) {
  return <View style={{ backgroundColor: '#FFFFFF', borderRadius: 22, overflow: 'hidden' }}>{children}</View>;
}

function ToggleRow({ label, value, onChange, first, testID }: { label: string; value: boolean; onChange: (v: boolean) => void; first: boolean; testID: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 8, paddingHorizontal: 16, borderTopWidth: first ? 0 : 1, borderTopColor: colors.hairline }}>
      <Text style={{ flex: 1, fontSize: 15, fontWeight: '500', color: colors.ink }}>{label}</Text>
      <Toggle testID={testID} label={label} value={value} onChange={onChange} />
    </View>
  );
}

function TriggerRow({ icon, label, onPress, first, testID }: { icon: IconName; label: string; onPress: () => void; first?: boolean; testID: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 8, paddingHorizontal: 16, borderTopWidth: first ? 0 : 1, borderTopColor: colors.hairline }}>
      <Icon name={icon} size={20} />
      <Text style={{ flex: 1, fontSize: 15, fontWeight: '500', color: colors.ink }}>{label}</Text>
      <Icon name="play_arrow" size={20} color={colors.gray5} />
    </Pressable>
  );
}

/** Demo Lab (design 597–624). The Live | Demo switch is the product's own addition. */
export function DemoLabScreen() {
  const snapshot = usePulse();
  const actions = usePulseActions();
  const insets = useSafeAreaInsets();
  const requested = useAppMode((s) => s.mode);
  const setMode = useAppMode((s) => s.setMode);
  const demo = snapshot.demo;
  const back = () => (router.canGoBack() ? router.back() : router.replace(routes.settings));

  const replayOnboarding = async () => {
    await actions.replayOnboarding();
    // Leave this screen for the welcome step; the tabs would redirect there anyway once they are in front.
    router.replace(routes.onboarding);
  };

  return (
    <Enter testID="demo-lab-screen" kind="slideIn" duration={350} ease="spring" style={{ flex: 1, backgroundColor: colors.page, paddingTop: insets.top }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: padBottom(insets.bottom, 44) }}>
        <View style={{ paddingTop: 8, paddingHorizontal: 20, alignItems: 'flex-start' }}>
          <IconButton icon="arrow_back" label="Back" size={42} onPress={back} />
        </View>
        <View style={{ paddingTop: 16, paddingHorizontal: 20, gap: 18 }}>
          <View>
            <Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: '700', letterSpacing: -0.4, color: colors.ink }}>
              {BRAND} Demo Lab
            </Text>
            <Text style={{ fontSize: 14, lineHeight: 20, color: colors.gray1, marginTop: 4 }}>Prototype and presentation controls. All data, AI output, encryption and networking here are simulated.</Text>
          </View>

          <View style={{ gap: 8 }}>
            <SegmentedControl<AppMode> options={MODES} value={requested} onChange={setMode} accessibilityLabel="Live or Demo" />
            <Text testID="mode-note" accessibilityLiveRegion="polite" style={{ fontSize: 13, lineHeight: 17, color: colors.gray1, paddingHorizontal: 4 }}>
              {snapshot.mode === 'demo' ? 'Demo is on. The SIMULATED bar stays on every screen until you switch back to Live.' : 'Live is on. Only measured state from this iPhone is shown.'}
            </Text>
          </View>

          {demo === null ? (
            <>
              <View testID="demo-off" style={{ flexDirection: 'row', gap: 10, backgroundColor: colors.hairline, borderRadius: 16, padding: 14 }}>
                <Icon name="info" size={18} color={colors.gray2} />
                <Text style={{ flex: 1, fontSize: 13, lineHeight: 19, color: colors.gray2 }}>Scenario controls appear after you switch to Demo. Switching does not touch your live requests or pairings.</Text>
              </View>
              <Group>
                <TriggerRow first testID="open-local-ai" icon="memory" label="Local AI diagnostics" onPress={() => router.push(routes.localAI)} />
                <TriggerRow testID="replay-onboarding" icon="replay" label="Replay onboarding" onPress={() => void replayOnboarding()} />
              </Group>
            </>
          ) : (
            <>
              <View>
                <SectionTitle>Device preview</SectionTitle>
                <Group>
                  {DEVICES.map((d, i) => {
                    const selected = demo.viewingAs === d.key;
                    return (
                      <Pressable
                        key={d.key}
                        testID={`view-as-${d.key}`}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`Preview as ${d.first}, ${d.device}`}
                        onPress={() => actions.demo.viewAs(d.key)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
                        <Avatar name={d.name} size={40} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>
                            {d.first} · {d.device}
                          </Text>
                          <Text style={{ fontSize: 12, color: colors.gray1 }}>{d.ai}</Text>
                        </View>
                        <View style={{ opacity: selected ? 1 : 0 }}>
                          <Icon name="check_circle" size={22} filled />
                        </View>
                      </Pressable>
                    );
                  })}
                </Group>
              </View>

              <View>
                <SectionTitle>Simulation toggles</SectionTitle>
                <Group>
                  <ToggleRow first testID="ai-ready" label="Main local AI ready" value={demo.aiReady} onChange={(v) => actions.demo.setAIReady(v)} />
                  <ToggleRow first={false} testID="link-mika" label="Mika in range" value={demo.links.mika} onChange={(v) => actions.demo.setLink('mika', v)} />
                  <ToggleRow first={false} testID="link-noah" label="Noah in range" value={demo.links.noah} onChange={(v) => actions.demo.setLink('noah', v)} />
                  <ToggleRow first={false} testID="demo-technical" label="Show technical details" value={snapshot.settings.showTechnicalDetails} onChange={(v) => void actions.updateSettings({ showTechnicalDetails: v })} />
                  <TriggerRow testID="trigger-anomaly" icon="vibration" label="Simulate motion anomaly" onPress={() => useSafetySession.getState().openAnomaly()} />
                  <TriggerRow testID="trigger-session" icon="directions_walk" label="Safety Session" onPress={() => router.push(routes.session)} />
                  <TriggerRow testID="open-local-ai" icon="memory" label="Local AI diagnostics" onPress={() => router.push(routes.localAI)} />
                  <TriggerRow testID="replay-onboarding" icon="replay" label="Replay onboarding" onPress={() => void replayOnboarding()} />
                </Group>
              </View>

              <View>
                <SectionTitle>Scenario presets</SectionTitle>
                <View style={{ gap: 8 }}>
                  {demo.scenarios.map((s, i) => {
                    const running = demo.runningScenario === s.key;
                    return (
                      <Pressable
                        key={s.key}
                        testID={`scenario-${s.key}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Run scenario ${i + 1}: ${brand(s.title)}. ${brand(s.description)}`}
                        accessibilityState={{ selected: running }}
                        onPress={() => actions.demo.runScenario(s.key)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: running ? colors.ink : colors.line, backgroundColor: '#FFFFFF' }}>
                        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: running ? colors.ink : colors.hairline, alignItems: 'center', justifyContent: 'center' }}>
                          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 14, fontWeight: '700', color: running ? '#FFFFFF' : colors.ink }}>
                            {i + 1}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>{brand(s.title)}</Text>
                          <Text style={{ fontSize: 13, color: colors.gray1, marginTop: 2 }}>{brand(s.description)}</Text>
                        </View>
                        <Icon name="play_circle" size={22} filled />
                      </Pressable>
                    );
                  })}
                  {demo.scenarios.length === 0 ? <Text style={{ fontSize: 13, color: colors.gray1, paddingHorizontal: 4 }}>No scenarios are available in this build.</Text> : null}
                </View>
              </View>

              <Pill
                testID="demo-reset"
                label="Reset Scenario"
                h={54}
                size={16}
                onPress={() => {
                  actions.demo.reset();
                  useSafetySession.getState().reset();
                }}
              />
            </>
          )}
        </View>
      </ScrollView>
    </Enter>
  );
}
