import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Avatar, ChoiceChip, GroupedList, ListRow, MicroPill, Screen, SectionHeader, TextButton, Toggle } from '@/ui';

import { routes } from '../nav';
import { shortDeviceId } from '../present';
import { CapabilityRows } from './CapabilityRows';

const COUNTDOWNS = [3, 5, 10] as const;
const LOCALES = [
  { key: 'en-US', label: 'English' },
  { key: 'fil-PH', label: 'Filipino' },
] as const;

function ToggleRow({ title, subtitle, value, onChange, first, testID }: { title: string; subtitle: string; value: boolean; onChange: (v: boolean) => void; first?: boolean; testID: string }) {
  return (
    <View className={`min-h-[54px] flex-row items-center gap-3 px-4 py-3 ${first ? '' : 'border-t border-hairline'}`}>
      <View className="flex-1">
        <Text className="text-[15.5px] font-semibold text-ink">{title}</Text>
        <Text className="mt-0.5 text-[13px] leading-[18px] text-gray-1">{subtitle}</Text>
      </View>
      <Toggle testID={testID} label={title} value={value} onChange={onChange} />
    </View>
  );
}

function InfoRow({ title, body, first }: { title: string; body: string; first?: boolean }) {
  return (
    <View className={`px-4 py-3 ${first ? '' : 'border-t border-hairline'}`}>
      <Text className="text-[15.5px] font-semibold text-ink">{title}</Text>
      <Text className="mt-0.5 text-[13px] leading-[18px] text-gray-1">{body}</Text>
    </View>
  );
}

export function SettingsScreen() {
  const snapshot = usePulse();
  const actions = usePulseActions();
  const { me, settings, capabilities } = snapshot;
  const keys = me.hardwareBackedKeys === null ? 'Not checked yet' : me.hardwareBackedKeys ? 'Held in the Secure Enclave' : 'Held in the Keychain (software)';
  const knownLocale = LOCALES.some((l) => l.key === settings.reportLocale);

  return (
    <Screen testID="settings-screen" tabbed title="Settings">
      <View className="flex-row items-center gap-[14px] rounded-feature bg-card p-4">
        <Avatar name={me.name.length > 0 ? me.name : '?'} size={58} self />
        <View className="flex-1">
          <Text className="text-[18px] font-bold text-ink">{me.name.length > 0 ? me.name : 'This device'}</Text>
          <Text testID="device-id" className="mt-0.5 text-[13px] text-gray-1">
            Device ID {shortDeviceId(me.deviceId)}
          </Text>
        </View>
        {snapshot.mode === 'demo' ? <MicroPill label="Simulated" /> : null}
      </View>

      <View>
        <SectionHeader title="Local AI" />
        <GroupedList>
          {capabilities ? (
            <>
              <ListRow first title={capabilities.provider} subtitle={`${capabilities.device.model} · iOS ${capabilities.device.osVersion}`} icon="memory" />
              <View className="border-t border-hairline">
                <CapabilityRows caps={capabilities} />
              </View>
            </>
          ) : (
            <ListRow first title="Checking this iPhone…" subtitle="Capabilities have not been read yet" icon="memory" />
          )}
          <View className="border-t border-hairline">
            <TextButton testID="refresh-capabilities" label="Check again" tone="ink" onPress={() => void actions.refreshCapabilities()} />
          </View>
        </GroupedList>
        <Text className="px-1 pt-2 text-[12.5px] leading-[17px] text-gray-1">Everything runs on this iPhone; no cloud model is used. Manual SOS does not depend on any of these.</Text>
      </View>

      <View>
        <SectionHeader title="Network" />
        <GroupedList>
          <ToggleRow first testID="toggle-discovery" title="Nearby discovery" subtitle="Find and be found by iPhones running PULSE nearby" value={settings.discoveryEnabled} onChange={(v) => void actions.setDiscovery(v)} />
          <ToggleRow testID="toggle-relay" title="Pass along for others" subtitle="Forward sealed requests between your trusted devices. This iPhone cannot read them." value={settings.relayEnabled} onChange={(v) => void actions.updateSettings({ relayEnabled: v })} />
        </GroupedList>
      </View>

      <View>
        <SectionHeader title="SOS" />
        <GroupedList>
          <View className="gap-2 px-4 py-3">
            <Text className="text-[15.5px] font-semibold text-ink">Countdown before saving</Text>
            <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
              {COUNTDOWNS.map((s) => (
                <ChoiceChip key={s} testID={`countdown-${s}`} label={`${s} seconds`} selected={settings.sosCountdownSeconds === s} onPress={() => void actions.updateSettings({ sosCountdownSeconds: s })} />
              ))}
            </View>
            <Text className="text-[13px] leading-[18px] text-gray-1">When it ends the request is saved and queued. “Send SOS now” skips the wait.</Text>
          </View>
          <View className="gap-2 border-t border-hairline px-4 py-3">
            <Text className="text-[15.5px] font-semibold text-ink">Report language</Text>
            <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
              {LOCALES.map((l) => (
                <ChoiceChip key={l.key} testID={`locale-${l.key}`} label={l.label} selected={settings.reportLocale === l.key} onPress={() => void actions.updateSettings({ reportLocale: l.key })} />
              ))}
              {knownLocale ? null : <ChoiceChip label={settings.reportLocale} selected onPress={() => undefined} />}
            </View>
            <Text className="text-[13px] leading-[18px] text-gray-1">Used for voice transcription. Typed reports can be in any language; whether the model understands them depends on this iPhone.</Text>
          </View>
        </GroupedList>
      </View>

      <View>
        <SectionHeader title="Privacy and permissions" />
        <GroupedList>
          <InfoRow first title="Local Network" body="Needed to find and reach nearby iPhones. iOS asks the first time discovery starts. Without it, requests are saved here and not delivered." />
          <InfoRow title="Microphone" body="Asked only when you tap record on a voice report. Never needed to send an SOS." />
          <InfoRow title="Stored on this device" body="Requests, reports and their history stay in this app’s storage. There is no account and no server." />
          <InfoRow title="Device keys" body={keys} />
          <InfoRow title="No camera" body="PULSE has no photo or camera features." />
          <ToggleRow testID="toggle-technical" title="Show technical details" subtitle="Adds identifiers and delivery internals where available" value={settings.showTechnicalDetails} onChange={(v) => void actions.updateSettings({ showTechnicalDetails: v })} />
        </GroupedList>
      </View>

      <View>
        <SectionHeader title="Prototype" />
        <GroupedList>
          <ListRow first testID="open-demo-lab" icon="science" title="Demo Lab" subtitle={snapshot.mode === 'demo' ? 'Demo mode is on · everything is simulated' : 'Simulated scenarios, kept apart from live data'} onPress={() => router.push(routes.demoLab)} />
        </GroupedList>
      </View>

      <Text className="pb-2 text-center text-[12px] leading-[18px] text-gray-4">
        PULSE is a prototype. It is not an emergency service or a medical device.{'\n'}It never calls emergency services.
      </Text>
    </Screen>
  );
}
