import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DemoDevice } from '@/services/api';
import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Avatar, Banner, Dialog, Enter, Icon, SegmentedControl, Toggle, colors, tabBarHeight, useToast, type IconName } from '@/ui';

import { IntelligenceSheet } from '../ai/IntelligenceSheet';
import { useSafetySession } from '../demo/safetySession';
import { routes } from '../nav';
import { BRAND, presentAIState, shortDeviceId } from '../present';

type RowProps = {
  icon: IconName;
  label: string;
  first: boolean;
  color?: string;
  value?: string;
  nav?: boolean;
  onPress?: () => void;
  trailing?: ReactNode;
  testID?: string;
};

/** One settings row (design 399–406): min-height 54, padding 8/16, 20pt icon, 15.5pt medium label. */
function Row({ icon, label, first, color = colors.ink, value, nav, onPress, trailing, testID }: RowProps) {
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingVertical: 8, paddingHorizontal: 16, borderTopWidth: first ? 0 : 1, borderTopColor: colors.hairline }}>
      <Icon name={icon} size={20} color={color} />
      <Text style={{ flex: 1, fontSize: 15.5, fontWeight: '500', color }}>{label}</Text>
      {value ? <Text style={{ fontSize: 14, color: colors.gray1, textAlign: 'right', maxWidth: 150 }}>{value}</Text> : null}
      {nav ? <Icon name="chevron_right" size={20} color={colors.gray5} /> : null}
      {trailing}
    </View>
  );
  if (!onPress) return <View testID={testID}>{body}</View>;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={value ? `${label}, ${value}` : label} onPress={onPress}>
      {body}
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View>
      <Text accessibilityRole="header" style={{ fontSize: 13, fontWeight: '600', color: colors.gray1, paddingHorizontal: 6, paddingBottom: 8 }}>
        {title}
      </Text>
      <View style={{ backgroundColor: '#FFFFFF', borderRadius: 22, overflow: 'hidden' }}>{children}</View>
    </View>
  );
}

const COUNTDOWNS = [
  { key: '3', label: '3s' },
  { key: '5', label: '5s' },
  { key: '10', label: '10s' },
] as const;
const LOCALES = [
  { key: 'en-US', label: 'English' },
  { key: 'fil-PH', label: 'Filipino' },
] as const;
const PREVIEW: readonly { key: DemoDevice; label: string }[] = [
  { key: 'alex', label: 'Alex' },
  { key: 'mika', label: 'Mika' },
  { key: 'noah', label: 'Noah' },
];
const SEG = { height: 28, radius: 10, itemRadius: 8, pad: 2, gap: 2, fontSize: 13, hug: true } as const;

/** Settings (design 386–413), every row bound to real state. */
export function SettingsScreen() {
  const snapshot = usePulse();
  const actions = usePulseActions();
  const insets = useSafeAreaInsets();
  const toast = useToast((s) => s.show);
  const sessionActive = useSafetySession((s) => s.active);
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState<'delete' | 'reset' | null>(null);
  const { me, settings, capabilities: caps, demo } = snapshot;
  const isDemo = snapshot.mode === 'demo';
  // Live only: the Demo Lab is in memory by design and already says it is simulated.
  const memoryOnly = !isDemo && snapshot.storage?.settingsPersistent === false;
  const trusted = snapshot.peers.filter((p) => p.trusted).length;
  const keys = me.hardwareBackedKeys === null ? 'Not checked yet' : me.hardwareBackedKeys ? 'Secure Enclave' : 'Keychain';
  const model = !caps ? 'Checking…' : caps.source === 'simulated' ? 'Simulation' : caps.text.state === 'ready' ? 'Ready on-device' : presentAIState(caps.text.state).label;
  const countdown = String(settings.sosCountdownSeconds);
  const info = (message: string) => () => toast(message, 'info');

  return (
    <View testID="settings-screen" style={{ flex: 1, backgroundColor: colors.page, paddingTop: insets.top }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: tabBarHeight(insets.bottom) + 30 }}>
        <Enter kind="fadeUp" duration={350} style={{ paddingTop: 8, paddingHorizontal: 20, gap: 20 }}>
          <Text accessibilityRole="header" style={{ fontSize: 30, fontWeight: '700', letterSpacing: -0.9, color: colors.ink, paddingTop: 6 }}>
            Settings
          </Text>

          {memoryOnly ? (
            <Banner testID="settings-memory-only" icon="warning" roomy text="Your profile, paired devices and settings are held in memory only on this device. They will be lost when the app closes." />
          ) : null}

          <View style={{ backgroundColor: '#FFFFFF', borderRadius: 24, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Avatar name={me.name.length > 0 ? me.name : '?'} size={58} self />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{me.name.length > 0 ? me.name : 'This device'}</Text>
              <Text testID="device-id" style={{ fontSize: 13, color: colors.gray1, marginTop: 2 }}>
                {caps ? `${caps.device.model} · ` : ''}Device ID {shortDeviceId(me.deviceId)}
              </Text>
            </View>
            <View style={{ backgroundColor: colors.hairline, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 }}>
              <Text testID="profile-pill" style={{ fontSize: 12, fontWeight: '600', color: colors.ink }}>
                {isDemo ? 'Simulated' : 'This iPhone'}
              </Text>
            </View>
          </View>

          <Section title="Profile">
            <Row first testID="row-name" icon="person" label="Name" value={me.name} />
          </Section>

          <Section title="Safety">
            <Row first testID="row-trusted-contacts" icon="group" label="Trusted contacts" value={String(trusted)} nav onPress={() => router.navigate(routes.network)} />
            <Row
              first={false}
              icon="timer"
              label="SOS countdown"
              trailing={
                <SegmentedControl
                  {...SEG}
                  accessibilityLabel="SOS countdown"
                  options={COUNTDOWNS.some((c) => c.key === countdown) ? COUNTDOWNS : [...COUNTDOWNS, { key: countdown, label: `${countdown}s` }]}
                  value={countdown}
                  onChange={(k) => void actions.updateSettings({ sosCountdownSeconds: Number(k) })}
                />
              }
            />
            {isDemo ? <Row first={false} testID="row-session" icon="directions_walk" label="Safety sessions" value={sessionActive ? 'Active' : undefined} nav onPress={() => router.push(routes.session)} /> : null}
          </Section>

          <Section title="Local AI">
            <Row first testID="open-intelligence" icon="memory" label="Model availability" value={model} nav onPress={() => setSheet(true)} />
            <Row
              first={false}
              icon="translate"
              label="Report language"
              trailing={
                <SegmentedControl
                  {...SEG}
                  accessibilityLabel="Report language"
                  options={LOCALES.some((l) => l.key === settings.reportLocale) ? LOCALES : [...LOCALES, { key: settings.reportLocale, label: settings.reportLocale }]}
                  value={settings.reportLocale}
                  onChange={(k) => void actions.updateSettings({ reportLocale: k })}
                />
              }
            />
            <Row first={false} icon="offline_bolt" label="Offline processing details" nav onPress={info('Reports are read on this iPhone. No cloud model is used.')} />
            <Row first={false} icon="shield_person" label="Privacy explanation" nav onPress={info('Reports never leave this iPhone for AI processing.')} />
          </Section>

          <Section title="Network">
            <Row first icon="radar" label="Nearby discovery" trailing={<Toggle testID="toggle-discovery" label="Nearby discovery" value={settings.discoveryEnabled} onChange={(v) => void actions.setDiscovery(v)} />} />
            <Row first={false} testID="row-trusted-devices" icon="devices" label="Trusted devices" value={String(trusted)} nav onPress={() => router.push(routes.pair)} />
            <Row
              first={false}
              icon="alt_route"
              label="Incident relay permissions"
              trailing={<Toggle testID="toggle-relay" label="Incident relay permissions" value={settings.relayEnabled} onChange={(v) => void actions.updateSettings({ relayEnabled: v })} />}
            />
          </Section>

          <Section title="Demo">
            <Row first testID="open-demo-lab" icon="science" label={`${BRAND} Demo Lab`} value={isDemo ? 'Simulated' : 'Off'} nav onPress={() => router.push(routes.demoLab)} />
            <Row
              first={false}
              icon="description"
              label="Show technical details"
              trailing={<Toggle testID="toggle-technical" label="Show technical details" value={settings.showTechnicalDetails} onChange={(v) => void actions.updateSettings({ showTechnicalDetails: v })} />}
            />
            {isDemo && demo ? (
              <>
                <Row first={false} testID="reset-mock" icon="restart_alt" label="Reset mock data" onPress={() => setDialog('reset')} />
                <Row
                  first={false}
                  icon="smartphone"
                  label="Preview"
                  trailing={<SegmentedControl {...SEG} accessibilityLabel="Preview as" options={PREVIEW} value={demo.viewingAs} onChange={(k) => actions.demo.viewAs(k)} />}
                />
                <Row
                  first={false}
                  icon="link_off"
                  label="Simulate connection loss"
                  trailing={<Toggle testID="toggle-link-mika" label="Simulate connection loss" value={!demo.links.mika} onChange={(v) => actions.demo.setLink('mika', !v)} />}
                />
              </>
            ) : null}
          </Section>

          <Section title="Privacy">
            <Row first icon="folder_managed" label="Local data controls" nav onPress={info('Requests and their history stay in this app on this iPhone.')} />
            <Row first={false} testID="row-keys" icon="key" label="Device keys" value={keys} />
            {snapshot.incidents.length > 0 ? <Row first={false} testID="delete-all" icon="delete" label="Delete incidents on this device" color={colors.coralText} onPress={() => setDialog('delete')} /> : null}
            <Row first={false} icon="policy" label="Permission explanations" nav onPress={info('Local Network and Microphone are asked only when first needed.')} />
          </Section>

          <Text testID="settings-footer" style={{ fontSize: 12, lineHeight: 18, color: colors.gray4, textAlign: 'center', paddingBottom: 8 }}>
            {isDemo
              ? `${BRAND} prototype · All data, AI output and networking are simulated.\nNo real alerts or emergency calls are made.`
              : `${BRAND} prototype · Not an emergency service or a medical device.\nIt never calls emergency services.`}
          </Text>
        </Enter>
      </ScrollView>

      <IntelligenceSheet visible={sheet} onClose={() => setSheet(false)} />
      <Dialog
        visible={dialog === 'delete'}
        title="Delete all incidents here?"
        message="This removes every request and its history from this device only. Copies already delivered to other devices are not deleted. Your identity and pairings stay."
        cancelLabel="Keep"
        confirmLabel="Delete"
        destructive
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          setDialog(null);
          void actions.deleteAllIncidents();
        }}
      />
      <Dialog
        visible={dialog === 'reset'}
        title="Reset mock data?"
        message="Restores the simulated incidents, devices and settings."
        cancelLabel="Cancel"
        confirmLabel="Reset"
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          setDialog(null);
          actions.demo.reset();
          useSafetySession.getState().reset();
        }}
      />
    </View>
  );
}
