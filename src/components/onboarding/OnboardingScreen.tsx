import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Avatar, EASE, Enter, Icon, IconButton, LinkButton, LogoMark, Pill, PulseRing, Ring, Toggle, colors, padBottom, type IconName } from '@/ui';

import { useAppMode } from '../appMode';
import { BRAND, presentAIState, presentReadiness } from '../present';
import { Splash } from './Splash';
import { Text, TextInput } from '@/ui/Text';

const STEPS = 5;
const SPLASH_MS = 2200;

const TITLE = { fontSize: 28, fontWeight: '700', letterSpacing: -0.4, lineHeight: 33, color: colors.ink } as const;
const SUB = { fontSize: 15, lineHeight: 21, color: colors.gray1, marginTop: 10 } as const;

const FOR_OPTIONS: readonly { label: string; icon: IconName }[] = [
  { label: 'Myself', icon: 'person' },
  { label: 'My family', icon: 'family_restroom' },
  { label: 'My community', icon: 'groups' },
  { label: 'My workplace team', icon: 'work' },
];

const ROLE_OPTIONS: readonly { label: string; desc: string; icon: IconName }[] = [
  { label: 'Individual', desc: 'Request help from your safety circle', icon: 'person' },
  { label: 'Trusted responder', desc: 'Receive and respond to nearby requests', icon: 'volunteer_activism' },
  { label: 'Team coordinator', desc: 'Oversee a group’s safety network', icon: 'hub' },
];

/** The three orbit avatars of the Welcome illustration (design 59–61). */
const ORBIT = [
  { name: 'Mika Santos', left: 224, top: 13, bg: '#F1E6DA', fg: '#7A5634', online: true },
  { name: 'Noah Cruz', left: 27, top: 162, bg: '#DDEBE4', fg: '#2F6B52', online: true },
  { name: 'Sofia Reyes', left: 190, top: 256, bg: '#E4E7F3', fg: '#46508A', online: false },
] as const;

function Welcome({ onStart }: { onStart: () => void }) {
  const { mode } = usePulse();
  const setMode = useAppMode((s) => s.setMode);
  const insets = useSafeAreaInsets();
  const demo = mode === 'demo';
  return (
    <Enter
      testID="welcome-screen"
      kind="fadeIn"
      duration={500}
      style={{ flex: 1, backgroundColor: '#FFFFFF', paddingTop: insets.top, paddingHorizontal: 24, paddingBottom: padBottom(insets.bottom) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12 }}>
        <LogoMark box={28} radius={9} glyph={18} stroke={5} />
        <Text style={{ fontSize: 17, fontWeight: '700', letterSpacing: -0.4, color: colors.ink }}>{BRAND}</Text>
      </View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <View testID="welcome-orbit" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 300, height: 300 }}>
          <View style={{ position: 'absolute', left: 45, top: 45, width: 210, height: 210, borderRadius: 105, backgroundColor: '#FBFBFC' }} />
          <PulseRing size={110} color={colors.coral} outline={1.5} durationMs={2800} style={{ left: 95, top: 95 }} />
          <View style={{ position: 'absolute', left: 114, top: 114 }}>
            <LogoMark box={72} radius={24} glyph={42} stroke={3.4} dot shadow />
          </View>
          {ORBIT.map((o) => (
            <View
              key={o.name}
              style={{ position: 'absolute', left: o.left, top: o.top, shadowColor: '#000000', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } }}>
              {demo ? (
                <Avatar name={o.name} size={46} ring={3} presence={o.online ? 'online' : 'offline'} dotSize={11} dotInset={-1} />
              ) : (
                // Live: no invented people. Same disc, same tint, a generic person glyph.
                <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: o.bg, borderWidth: 3, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="person" size={20} color={o.fg} />
                </View>
              )}
            </View>
          ))}
        </View>
      </View>
      <Text accessibilityRole="header" style={{ fontSize: 34, fontWeight: '700', letterSpacing: -0.6, lineHeight: 37, color: colors.ink }}>
        You’re never meant to face an emergency alone.
      </Text>
      <Text style={{ fontSize: 16, lineHeight: 24, color: colors.gray1, marginTop: 12 }}>Stay connected to people you trust—even when the internet isn’t.</Text>
      <View style={{ gap: 6, marginTop: 28 }}>
        <Pill testID="get-started" label="Get Started" h={58} size={17} press={0.98} onPress={onStart} />
        {demo ? null : <LinkButton testID="explore-demo" label="Explore Demo" size={16} h={50} onPress={() => setMode('demo')} />}
      </View>
    </Enter>
  );
}

function OptionCard({ label, desc, icon, selected, onPress, tall, testID }: { label: string; desc?: string; icon: IconName; selected: boolean; onPress: () => void; tall?: boolean; testID: string }) {
  const fg = selected ? '#FFFFFF' : colors.ink;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={desc ? `${label}. ${desc}` : label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        minHeight: tall ? 76 : 64,
        paddingVertical: tall ? 14 : 0,
        paddingHorizontal: 20,
        borderRadius: 18,
        backgroundColor: selected ? colors.ink : colors.hairline,
      }}>
      <Icon name={icon} size={tall ? 24 : 22} color={fg} />
      {desc ? (
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 17, fontWeight: '600', color: fg }}>{label}</Text>
          <Text style={{ fontSize: 13, marginTop: 3, color: selected ? 'rgba(255,255,255,0.7)' : colors.gray1 }}>{desc}</Text>
        </View>
      ) : (
        <Text style={{ flex: 1, fontSize: 17, fontWeight: '600', color: fg }}>{label}</Text>
      )}
    </Pressable>
  );
}

function ContactRow({ avatar, name, sub, selected, testID }: { avatar: ReactNode; name: string; sub: string; selected: boolean; testID: string }) {
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${name}. ${sub}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 72, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: selected ? colors.ink : colors.line, backgroundColor: '#FFFFFF' }}>
      {avatar}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{name}</Text>
        <Text style={{ fontSize: 13, color: colors.gray1, marginTop: 2 }}>{sub}</Text>
      </View>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: selected ? colors.ink : '#FFFFFF',
          borderWidth: selected ? 0 : 1.5,
          borderColor: colors.disabled,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Icon name="check" size={18} color="#FFFFFF" />
      </View>
    </View>
  );
}

function PrefRow({ icon, label, desc, value, onChange, first, disabled, testID }: { icon: IconName; label: string; desc: string; value: boolean; onChange: (v: boolean) => void; first: boolean; disabled?: boolean; testID: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderTopWidth: first ? 0 : 1, borderTopColor: colors.hairline }}>
      <Icon name={icon} size={22} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{label}</Text>
        <Text style={{ fontSize: 13, lineHeight: 18, color: colors.gray1, marginTop: 3 }}>{desc}</Text>
      </View>
      <Toggle testID={testID} label={label} value={value} onChange={onChange} disabled={disabled} />
    </View>
  );
}

function ReadyRow({ lead, title, sub, pill, pillFg, pillBg, first, testID }: { lead: ReactNode; title: string; sub: string; pill: string; pillFg: string; pillBg: string; first: boolean; testID: string }) {
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: first ? 0 : 1, borderTopColor: colors.hairline }}>
      {lead}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>{title}</Text>
        <Text style={{ fontSize: 12, color: colors.gray1 }}>{sub}</Text>
      </View>
      <View style={{ backgroundColor: pillBg, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: pillFg }}>{pill}</Text>
      </View>
    </View>
  );
}

function ProgressBar({ step }: { step: number }) {
  const reduced = useReducedMotion();
  const pct = ((step + 1) / STEPS) * 100;
  const w = useSharedValue(pct);
  useEffect(() => {
    w.value = reduced ? pct : withTiming(pct, { duration: 450, easing: EASE.spring });
  }, [pct, reduced, w]);
  const fill = useAnimatedStyle(() => ({ width: `${w.value}%` }));
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={`Step ${step + 1} of ${STEPS}`} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: 'hidden' }}>
      <Animated.View style={[{ height: '100%', backgroundColor: colors.ink, borderRadius: 2 }, fill]} />
    </View>
  );
}

/** Splash, Welcome and the five onboarding steps (design 37–159). */
export function OnboardingScreen({ initial = 'splash' }: { initial?: 'splash' | 'welcome' }) {
  const snapshot = usePulse();
  const actions = usePulseActions();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<'splash' | 'welcome' | 'steps'>(initial);
  const [step, setStep] = useState(0);
  const [usingFor, setUsingFor] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [name, setName] = useState(snapshot.me.name);
  const [prefs, setPrefs] = useState({ manual: true, checkins: true, fall: false, location: true });
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (phase !== 'splash') return undefined;
    const timer = setTimeout(() => setPhase('welcome'), SPLASH_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  if (phase === 'splash') return <Splash />;
  if (phase === 'welcome') {
    return (
      <Welcome
        onStart={() => {
          setStep(0);
          setPhase('steps');
        }}
      />
    );
  }

  const demo = snapshot.mode === 'demo';
  const caps = snapshot.capabilities;
  const trusted = snapshot.peers.filter((p) => p.trusted);
  const readiness = presentReadiness(snapshot);
  const canContinue = step === 0 ? usingFor !== null : step === 1 ? role !== null && name.trim().length > 0 : true;

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

  const aiPill = !caps ? 'Checking…' : caps.source === 'simulated' ? 'Simulation' : presentAIState(caps.text.state).label;
  const aiReady = caps?.text.state === 'ready';

  return (
    <View testID="onboarding-screen" style={{ flex: 1, backgroundColor: '#FFFFFF', paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingTop: 10, paddingHorizontal: 24 }}>
        <IconButton testID="onboarding-back" icon="arrow_back" label="Back" onCard size={40} onPress={() => (step === 0 ? setPhase('welcome') : setStep(step - 1))} />
        <ProgressBar step={step} />
        <Text testID="onboarding-step" style={{ fontSize: 13, fontWeight: '600', color: colors.gray1, minWidth: 28, textAlign: 'right' }}>
          {step + 1}/{STEPS}
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 32, paddingHorizontal: 24, paddingBottom: 140 }}>
        {step === 0 ? (
          <Enter key="s0" kind="slideIn" duration={350}>
            <Text accessibilityRole="header" style={TITLE}>
              Who are you using {BRAND} for?
            </Text>
            <Text style={SUB}>We’ll shape your safety circle around it.</Text>
            <View accessibilityRole="radiogroup" style={{ gap: 12, marginTop: 36 }}>
              {FOR_OPTIONS.map((o, i) => (
                <OptionCard key={o.label} testID={`for-${i}`} label={o.label} icon={o.icon} selected={usingFor === o.label} onPress={() => setUsingFor(o.label)} />
              ))}
            </View>
          </Enter>
        ) : null}

        {step === 1 ? (
          <Enter key="s1" kind="slideIn" duration={350}>
            <Text accessibilityRole="header" style={TITLE}>
              Choose your role
            </Text>
            <Text style={SUB}>You can change this later in Settings.</Text>
            <View accessibilityRole="radiogroup" style={{ gap: 12, marginTop: 36 }}>
              {ROLE_OPTIONS.map((o, i) => (
                <OptionCard key={o.label} testID={`role-${i}`} tall label={o.label} desc={o.desc} icon={o.icon} selected={role === o.label} onPress={() => setRole(o.label)} />
              ))}
            </View>
            <View style={{ gap: 6, marginTop: 20 }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: colors.gray1 }}>Your name</Text>
              <TextInput
                testID="name-input"
                accessibilityLabel="Your name"
                value={name}
                onChangeText={setName}
                placeholder="Shown to people you pair with"
                placeholderTextColor={colors.gray4}
                maxLength={80}
                returnKeyType="done"
                style={{ minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: colors.lineInput, backgroundColor: '#FAFAFB', paddingHorizontal: 14, paddingVertical: 0, fontSize: 16, color: colors.ink }}
              />
            </View>
          </Enter>
        ) : null}

        {step === 2 ? (
          <Enter key="s2" kind="slideIn" duration={350}>
            <Text accessibilityRole="header" style={TITLE}>
              Set up your safety circle
            </Text>
            <Text style={SUB}>These people can receive your requests through nearby devices.</Text>
            <View style={{ gap: 10, marginTop: 32 }}>
              {snapshot.peers.length === 0 ? (
                <ContactRow
                  testID="circle-empty"
                  selected={false}
                  name="No devices yet"
                  sub="Pair a trusted iPhone later in Network"
                  avatar={
                    <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.line, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="person" size={22} color={colors.gray1} />
                    </View>
                  }
                />
              ) : (
                snapshot.peers.map((p) => (
                  <ContactRow
                    key={p.deviceId}
                    testID={`circle-${p.deviceId}`}
                    selected={p.trusted}
                    name={p.name}
                    sub={p.trusted ? 'Trusted · code confirmed' : p.reach === 'unreachable' ? 'Not reachable' : 'Nearby · pair it in Network'}
                    avatar={<Avatar name={p.name} size={44} />}
                  />
                ))
              )}
            </View>
          </Enter>
        ) : null}

        {step === 3 ? (
          <Enter key="s3" kind="slideIn" duration={350}>
            <Text accessibilityRole="header" style={TITLE}>
              Safety monitoring preferences
            </Text>
            <Text style={SUB}>Choose what {BRAND} can do on your behalf.</Text>
            <View style={{ backgroundColor: '#FFFFFF', borderRadius: 22, marginTop: 28, overflow: 'hidden' }}>
              {demo ? (
                <>
                  <PrefRow first testID="pref-manual" icon="sos" label="Manual SOS" desc="Request help with one tap" value={prefs.manual} onChange={(v) => setPrefs({ ...prefs, manual: v })} />
                  <PrefRow first={false} testID="pref-checkins" icon="timer" label="Active safety check-ins" desc="Timed check-ins during safety sessions" value={prefs.checkins} onChange={(v) => setPrefs({ ...prefs, checkins: v })} />
                  <PrefRow first={false} testID="pref-fall" icon="directions_walk" label="Possible fall detection" desc="Simulated motion analysis" value={prefs.fall} onChange={(v) => setPrefs({ ...prefs, fall: v })} />
                  <PrefRow first={false} testID="pref-location" icon="location_on" label="Location sharing during incidents" desc="Shared with your trusted circle only while a request is open" value={prefs.location} onChange={(v) => setPrefs({ ...prefs, location: v })} />
                </>
              ) : (
                <>
                  <PrefRow first testID="pref-manual" icon="sos" label="Manual SOS" desc="Request help with one tap" value disabled onChange={() => undefined} />
                  <PrefRow first={false} testID="pref-discovery" icon="radar" label="Nearby discovery" desc="Find and be found by trusted iPhones nearby" value={snapshot.settings.discoveryEnabled} onChange={(v) => void actions.setDiscovery(v)} />
                  <PrefRow first={false} testID="pref-relay" icon="alt_route" label="Incident relay" desc="Pass along sealed requests between your trusted devices" value={snapshot.settings.relayEnabled} onChange={(v) => void actions.updateSettings({ relayEnabled: v })} />
                </>
              )}
            </View>
            <View style={{ flexDirection: 'row', gap: 10, backgroundColor: colors.page, borderRadius: 16, padding: 14, marginTop: 14 }}>
              <Icon name="info" size={18} color={colors.gray2} />
              <Text testID="pref-note" style={{ flex: 1, fontSize: 13, lineHeight: 19, color: colors.gray2 }}>
                {demo
                  ? `Monitoring requires your explicit permission and may be limited while ${BRAND} isn’t active. In this prototype, monitoring is simulated.`
                  : `Nothing is monitored in the background. ${BRAND} acts only when you ask it to.`}
              </Text>
            </View>
          </Enter>
        ) : null}

        {step === 4 ? (
          <Enter key="s4" kind="slideIn" duration={350} style={{ alignItems: 'center' }}>
            <View style={{ marginTop: 8 }}>
              <Ring size={180} r={78} stroke={12} progress={readiness.progress}>
                <Icon name="verified_user" size={40} filled />
                <Text testID="onboarding-ready-count" style={{ fontSize: 13, fontWeight: '600', color: colors.gray1, marginTop: 6 }}>
                  {readiness.title}
                </Text>
              </Ring>
            </View>
            <Text accessibilityRole="header" style={[TITLE, { marginTop: 28, textAlign: 'center' }]}>
              {trusted.length > 0 ? 'Your safety circle is ready.' : `${BRAND} is set up.`}
            </Text>
            <Text style={{ fontSize: 15, color: colors.gray1, marginTop: 10, textAlign: 'center' }}>
              {trusted.length > 0 ? `${trusted.length} trusted ${trusted.length === 1 ? 'device' : 'devices'} set up for local relay.` : 'No trusted device yet. Pair one in Network.'}
            </Text>
            <View style={{ alignSelf: 'stretch', backgroundColor: '#FFFFFF', borderRadius: 22, marginTop: 24, overflow: 'hidden' }}>
              <ReadyRow
                first
                testID="ready-me"
                lead={<Avatar name={name.trim().length > 0 ? name : '?'} size={38} self />}
                title={name.trim()}
                sub={caps ? caps.device.model : 'This iPhone'}
                pill="This device"
                pillFg={colors.greenText}
                pillBg={colors.greenTint}
              />
              {trusted.map((p) => {
                const ok = p.reach === 'connected';
                return (
                  <ReadyRow
                    key={p.deviceId}
                    first={false}
                    testID={`ready-${p.deviceId}`}
                    lead={<Avatar name={p.name} size={38} />}
                    title={p.name}
                    sub="Trusted device"
                    pill={ok ? 'Reachable' : 'Not reachable'}
                    pillFg={ok ? colors.greenText : colors.ink}
                    pillBg={ok ? colors.greenTint : colors.hairline}
                  />
                );
              })}
              <ReadyRow
                first={false}
                testID="ready-ai"
                lead={
                  <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: colors.hairline, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="auto_awesome" size={20} />
                  </View>
                }
                title="Local AI"
                sub={caps ? caps.provider : 'Checking…'}
                pill={aiPill}
                pillFg={aiReady && caps?.source !== 'simulated' ? colors.greenText : colors.ink}
                pillBg={aiReady && caps?.source !== 'simulated' ? colors.greenTint : colors.hairline}
              />
            </View>
            {failed ? (
              <View testID="onboarding-failed" accessibilityRole="alert" style={{ alignSelf: 'stretch', flexDirection: 'row', gap: 10, backgroundColor: colors.coralTint, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, marginTop: 14 }}>
                <Icon name="error" size={18} color="#9B3532" />
                <Text style={{ flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '500', color: '#9B3532' }}>Your name could not be saved on this device. Try again.</Text>
              </View>
            ) : null}
          </Enter>
        ) : null}
      </ScrollView>

      <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 20, paddingHorizontal: 24, paddingBottom: padBottom(insets.bottom) }}>
        <Svg pointerEvents="none" width="100%" height="100%" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="obFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
              <Stop offset="0.28" stopColor="#FFFFFF" stopOpacity={1} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#obFade)" />
        </Svg>
        <Pill
          testID="onboarding-next"
          label={step === STEPS - 1 ? (saving ? 'Saving…' : `Go to ${BRAND}`) : 'Continue'}
          h={58}
          size={17}
          disabled={!canContinue || saving}
          disabledLook="gray"
          onPress={() => void next()}
        />
      </View>
    </View>
  );
}
