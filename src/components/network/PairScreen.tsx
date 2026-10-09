import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Avatar, Banner, Button, GroupedList, Icon, Screen, TextButton, colors } from '@/ui';

import { useRun } from '../incident/useRun';
import { routes } from '../nav';
import { DISCOVERY_LABEL, presentReach } from '../present';

/** Pick a discovered device, compare the six-digit code on both phones, then confirm or reject. */
export function PairScreen() {
  const snapshot = usePulse();
  const actions = usePulseActions();
  const { busy, run } = useRun();
  const session = snapshot.pairing;
  // Remembers who the last session was with, so the outcome can be stated after the session ends.
  const [last, setLast] = useState<{ deviceId: string; name: string } | null>(null);
  if (session && (last?.deviceId !== session.peerDeviceId || last.name !== session.peerName)) {
    setLast({ deviceId: session.peerDeviceId, name: session.peerName });
  }
  const finished = !session && last ? { name: last.name, trusted: snapshot.peers.some((p) => p.deviceId === last.deviceId && p.trusted) } : null;

  const back = () => {
    if (session) void actions.cancelPairing();
    if (router.canGoBack()) router.back();
    else router.replace(routes.network);
  };

  if (session) {
    const digits = session.code.split('');
    return (
      <Screen testID="pair-screen" white onBack={back} title="Compare the code" subtitle={`Both phones must show the same six digits. Check ${session.peerName}’s screen before you confirm.`}>
        <View testID="pair-code" accessible accessibilityLabel={`Pairing code ${digits.join(' ')}`} className="flex-row justify-center gap-2 py-4">
          {digits.map((d, i) => (
            <View key={`${i}-${d}`} className="min-h-[60px] min-w-[44px] items-center justify-center rounded-[14px] bg-page px-2">
              <Text className="text-[32px] font-extrabold text-ink" style={{ fontVariant: ['tabular-nums'] }}>
                {d}
              </Text>
            </View>
          ))}
        </View>
        {session.stage === 'compare' ? (
          <View className="gap-[10px]">
            <Button testID="pair-confirm" label="The codes match" disabled={busy !== null} onPress={() => void run('confirm', () => actions.confirmPairing())} />
            <Button testID="pair-reject" label="Doesn’t match" variant="secondary" onPress={() => void actions.cancelPairing()} />
            <Text className="text-center text-[12.5px] leading-[17px] text-gray-1">If the codes differ, someone else may be in between. Do not confirm.</Text>
          </View>
        ) : null}
        {session.stage === 'awaiting_peer' ? (
          <View className="gap-[10px]">
            <Banner testID="pair-waiting" tone="gray" icon="hourglass_top" text={`You confirmed. Waiting for ${session.peerName} to confirm on their phone. Not trusted yet.`} />
            <TextButton label="Cancel pairing" tone="coral" onPress={() => void actions.cancelPairing()} />
          </View>
        ) : null}
        {session.stage === 'failed' ? (
          <View className="gap-[10px]">
            <Banner testID="pair-failed" tone="coral" icon="error" text={session.error && session.error.length > 0 ? `Pairing failed: ${session.error}` : 'Pairing failed. The devices are not trusted.'} />
            <Button label="Close" variant="secondary" onPress={() => void actions.cancelPairing()} />
          </View>
        ) : null}
      </Screen>
    );
  }

  const candidates = snapshot.peers.filter((p) => !p.trusted && p.reach !== 'unreachable');
  const discovery = snapshot.network.discovery;
  return (
    <Screen testID="pair-screen" white onBack={back} title="Pair a device" subtitle="Choose an iPhone running PULSE nearby. You will both see a six-digit code to compare.">
      {finished ? (
        <Banner
          testID="pair-result"
          tone={finished.trusted ? 'green' : 'gray'}
          icon={finished.trusted ? 'verified' : 'info'}
          text={finished.trusted ? `${finished.name} is now a trusted device. Both of you confirmed the code.` : `Pairing with ${finished.name} was not completed. Nothing changed.`}
        />
      ) : null}
      {discovery !== 'on' ? (
        <View className="gap-2">
          <Banner testID="pair-discovery" text={`${DISCOVERY_LABEL[discovery]}. Nearby devices cannot be found until discovery is running.`} />
          {discovery === 'off' ? <Button label="Turn on discovery" size="sm" onPress={() => void actions.setDiscovery(true)} /> : null}
        </View>
      ) : null}
      <GroupedList>
        {candidates.length === 0 ? (
          <View testID="pair-empty" className="items-center gap-1 px-5 py-8">
            <Icon name="radar" size={32} color={colors.gray4} />
            <Text className="mt-1 text-center text-[16px] font-semibold text-ink">No device to pair yet</Text>
            <Text className="text-center text-[13px] leading-[18px] text-gray-1">Open PULSE on the other iPhone and keep both phones close.</Text>
          </View>
        ) : (
          candidates.map((p, i) => (
            <Pressable
              key={p.deviceId}
              testID={`pair-pick-${p.deviceId}`}
              accessibilityRole="button"
              accessibilityLabel={`Pair with ${p.name}, ${presentReach(p).label}`}
              disabled={busy !== null}
              onPress={() => void run('pair', () => actions.startPairing(p.deviceId))}
              className={`min-h-[60px] flex-row items-center gap-3 px-4 py-3 ${i === 0 ? '' : 'border-t border-hairline'}`}>
              <Avatar name={p.name} size={40} />
              <View className="flex-1">
                <Text className="text-[15px] font-semibold text-ink">{p.name}</Text>
                <Text className="mt-[1px] text-[12.5px] text-gray-1">{presentReach(p).label}</Text>
              </View>
              <Icon name="chevron_right" size={20} color={colors.gray5} />
            </Pressable>
          ))
        )}
      </GroupedList>
      <Text className="px-1 text-[12.5px] leading-[17px] text-gray-1">A device becomes trusted only after both people confirm the same code. Seeing a device nearby does not make it trusted.</Text>
    </Screen>
  );
}
