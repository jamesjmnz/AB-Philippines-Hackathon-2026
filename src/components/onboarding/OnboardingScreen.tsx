import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Banner, Button, GroupedList, Icon, IconButton, PulseRing, TextButton, TextField, colors, type IconName } from '@/ui';

import { useAppMode } from '../appMode';
import { CapabilityRows } from '../settings/CapabilityRows';

function Logo({ size }: { size: number }) {
  return (
    <View className="items-center justify-center bg-ink" style={{ width: size, height: size, borderRadius: size * 0.3 }}>
      <Svg width={size * 0.58} height={size * 0.58} viewBox="0 0 52 52" accessibilityElementsHidden importantForAccessibility="no">
        <Polyline points="6,27 16,27 20,19 26,35 31,15 35,27 44,27" fill="none" stroke="#FFFFFF" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={45} cy={27} r={3} fill={colors.coral} />
      </Svg>
    </View>
  );
}

function Point({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <View className="flex-row gap-[14px] px-4 py-4">
      <Icon name={icon} size={22} />
      <View className="flex-1">
        <Text className="text-[16px] font-semibold text-ink">{title}</Text>
        <Text className="mt-[3px] text-[13px] leading-[18px] text-gray-1">{body}</Text>
      </View>
    </View>
  );
}

const STEPS = 4;

/** Welcome, then four steps: name, permissions (explained, not requested), on-device AI facts, limits. */
export function OnboardingScreen() {
  const snapshot = usePulse();
  const actions = usePulseActions();
  const setMode = useAppMode((s) => s.setMode);
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<number | null>(null);
  const [name, setName] = useState(snapshot.me.name);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const caps = snapshot.capabilities;

  if (step === null) {
    return (
      <View testID="welcome-screen" className="flex-1 bg-card px-6" style={{ paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 16) + 8 }}>
        <View className="flex-row items-center gap-2">
          <Logo size={28} />
          <Text className="text-[17px] font-extrabold tracking-[-0.3px] text-ink">PULSE</Text>
        </View>
        <View className="flex-1 items-center justify-center">
          <View className="h-[200px] w-[200px] items-center justify-center">
            <PulseRing size={150} color={colors.coral} durationMs={2800} />
            <Logo size={72} />
          </View>
        </View>
        <Text accessibilityRole="header" className="text-[34px] font-extrabold leading-[37px] tracking-[-1.2px] text-ink">
          You’re never meant to face an emergency alone.
        </Text>
        <Text className="mt-3 text-[16px] leading-[23px] text-gray-1">Reach people you trust through nearby iPhones, even when the internet isn’t there. Not an emergency service.</Text>
        <View className="mt-7 gap-1.5">
          <Button testID="get-started" label="Get Started" onPress={() => setStep(0)} />
          {snapshot.mode === 'live' ? <TextButton testID="explore-demo" label="Explore Demo" tone="ink" onPress={() => setMode('demo')} /> : null}
        </View>
      </View>
    );
  }

  const canContinue = step !== 0 || name.trim().length > 0;
  const next = async () => {
    if (!canContinue || saving) return;
    if (step < STEPS - 1) {
      setStep(step + 1);
      return;
    }
    setSaving(true);
    setFailed(false);
    try {
      await actions.completeOnboarding({ name: name.trim() });
    } catch {
      setFailed(true);
    }
    setSaving(false);
  };

  return (
    <View testID="onboarding-screen" className="flex-1 bg-card" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-4 px-6 pt-[10px]">
        <IconButton icon="arrow_back" label="Back" onCard onPress={() => setStep(step === 0 ? null : step - 1)} />
        <View accessibilityRole="progressbar" accessibilityLabel={`Step ${step + 1} of ${STEPS}`} className="h-1 flex-1 overflow-hidden rounded-full bg-line">
          <View className="h-full rounded-full bg-ink" style={{ width: `${((step + 1) / STEPS) * 100}%` }} />
        </View>
        <Text className="min-w-[28px] text-right text-[13px] font-semibold text-gray-1">
          {step + 1}/{STEPS}
        </Text>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        {step === 0 ? (
          <View className="gap-[10px]">
            <Text accessibilityRole="header" className="text-[30px] font-bold leading-[33px] tracking-[-0.9px] text-ink">
              What should people call you?
            </Text>
            <Text className="text-[15px] leading-[21px] text-gray-1">Shown to the people you pair with and on requests you send. No account, no sign-in, nothing leaves this iPhone until you pair.</Text>
            <View className="mt-6">
              <TextField testID="name-input" label="Your name" placeholder="Your name" value={name} onChangeText={setName} maxLength={80} autoFocus onSubmitEditing={() => void next()} />
            </View>
          </View>
        ) : null}

        {step === 1 ? (
          <View className="gap-[10px]">
            <Text accessibilityRole="header" className="text-[30px] font-bold leading-[33px] tracking-[-0.9px] text-ink">
              Two permissions, asked later
            </Text>
            <Text className="text-[15px] leading-[21px] text-gray-1">PULSE does not ask for anything now. iOS will ask at the moment each one is first needed.</Text>
            <View className="mt-5 overflow-hidden rounded-card bg-page">
              <Point icon="wifi" title="Local Network" body="Asked the first time PULSE looks for nearby iPhones. If you decline, requests are still saved on this iPhone but cannot be delivered to anyone." />
              <View className="border-t border-line">
                <Point icon="mic" title="Microphone" body="Asked only if you tap record on a voice report. Voice is optional and best-effort. Sending an SOS never needs it." />
              </View>
            </View>
            <Text className="mt-1 text-[13px] leading-[18px] text-gray-1">No location services, no contacts, no camera, no notifications are requested.</Text>
          </View>
        ) : null}

        {step === 2 ? (
          <View className="gap-[10px]">
            <Text accessibilityRole="header" className="text-[30px] font-bold leading-[33px] tracking-[-0.9px] text-ink">
              On-device AI on this iPhone
            </Text>
            <Text className="text-[15px] leading-[21px] text-gray-1">Each capability is checked separately. Some iPhones cannot run the text model; that is shown here as it is.</Text>
            <View className="mt-5">
              <GroupedList>
                {caps ? (
                  <View testID="onboarding-capabilities" className="bg-page">
                    <View className="px-4 py-3">
                      <Text className="text-[15px] font-semibold text-ink">{caps.provider}</Text>
                      <Text className="mt-0.5 text-[12.5px] text-gray-1">
                        {caps.device.model} · iOS {caps.device.osVersion}
                      </Text>
                    </View>
                    <View className="border-t border-line">
                      <CapabilityRows caps={caps} />
                    </View>
                  </View>
                ) : (
                  <View testID="onboarding-capabilities-pending" className="bg-page px-4 py-4">
                    <Text className="text-[14px] text-gray-1">Still checking this iPhone. You can continue; the result appears on Home and in Settings.</Text>
                  </View>
                )}
              </GroupedList>
            </View>
            <Text className="mt-1 text-[13px] leading-[18px] text-gray-1">No cloud model is used. Manual SOS works whether or not any of these are ready.</Text>
          </View>
        ) : null}

        {step === 3 ? (
          <View className="gap-[10px]">
            <Text accessibilityRole="header" className="text-[30px] font-bold leading-[33px] tracking-[-0.9px] text-ink">
              What PULSE does, and doesn’t
            </Text>
            <View className="mt-5 overflow-hidden rounded-card bg-page">
              <Point icon="sos" title="Saves your request first" body="An SOS is written to this iPhone and queued for your trusted devices. It shows Delivered only when one of them confirms receipt." />
              <View className="border-t border-line">
                <Point icon="group_add" title="Needs a paired device" body="Until you pair with someone in Network, nobody receives your requests." />
              </View>
              <View className="border-t border-line">
                <Point icon="call" title="Not an emergency service" body="PULSE never contacts emergency services and gives no medical advice. In an emergency, call your local emergency number." />
              </View>
            </View>
            {failed ? <Banner tone="coral" icon="error" text="Your name could not be saved on this device. Try again." /> : null}
          </View>
        ) : null}
      </ScrollView>

      <View className="px-6 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}>
        <Button testID="onboarding-next" label={step === STEPS - 1 ? (saving ? 'Saving…' : 'Go to PULSE') : 'Continue'} disabled={!canContinue || saving} onPress={() => void next()} />
      </View>
    </View>
  );
}
