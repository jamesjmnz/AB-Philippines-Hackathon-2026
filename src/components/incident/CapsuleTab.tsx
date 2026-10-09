import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { canPrepareCapsule, type Actor, type ClaimField, type DisclosureLevel } from '@/domain';
import type { FactView, IncidentView, RecipientPolicyInput } from '@/services/api';
import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Avatar, Icon, Pill, SegmentedControl, Toggle, colors, type IconName } from '@/ui';

import { DELIVERY_LOOK, FIELD_LABELS, LEVEL_LABELS, LEVEL_SHORT, presentDelivery } from '../present';
import { CardBox, SectionTitle, TagPill } from './parts';
import { useRun } from './useRun';
import { Text } from '@/ui/Text';

const ORDER: readonly (DisclosureLevel | 'off')[] = ['off', 'relay', 'trusted', 'authorized'];
const PREVIEW_LEVELS = [
  { key: 'relay', label: 'Passes along' },
  { key: 'trusted', label: 'Summary' },
  { key: 'authorized', label: 'Everything' },
] as const;

const FIELD_ICON: Record<ClaimField, IconName> = {
  incidentType: 'emergency',
  building: 'location_on',
  floor: 'location_on',
  locationText: 'location_on',
  symptom: 'description',
  assistanceRequested: 'pan_tool',
};

/** Preview row (design 578): 17pt icon, 13pt grey label, 14/600 value capped at 55%. */
function PreviewRow({ fact }: { fact: FactView }) {
  const readable = !fact.protected;
  const value = readable ? (fact.value ?? 'Unknown') : 'Protected';
  return (
    <View
      testID={`preview-${fact.field}`}
      accessible
      accessibilityLabel={`${FIELD_LABELS[fact.field]}: ${readable ? value : 'protected, not readable at this level'}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: colors.hairline }}>
      <Icon name={readable ? FIELD_ICON[fact.field] : 'lock'} size={17} color={readable ? colors.ink : colors.gray4} />
      <Text style={{ flex: 1, minWidth: 0, fontSize: 13, color: colors.gray1 }}>{FIELD_LABELS[fact.field]}</Text>
      <Text style={{ maxWidth: '55%', fontSize: 14, fontWeight: '600', textAlign: 'right', color: readable && fact.value !== null ? colors.ink : colors.gray1 }}>{value}</Text>
    </View>
  );
}

/** Capsule segment = the design's Privacy sub-page (571–593): preview per level, recipients, share toggles, send. */
export function CapsuleTab({ view, actor }: { view: IncidentView; actor: Actor }) {
  const { mode } = usePulse();
  const actions = usePulseActions();
  const { busy, run } = useRun();
  const owner = view.access === 'owner';
  const state = view.state;

  const initial = useMemo<RecipientPolicyInput>(() => {
    const levels: Record<string, DisclosureLevel | 'off'> = {};
    for (const r of state.recipients) levels[r.deviceId] = r.level;
    return { shareDetailedLocation: state.disclosure.shareDetailedLocation, shareSymptoms: state.disclosure.shareSymptoms, levels };
  }, [state.recipients, state.disclosure]);

  const [draft, setDraft] = useState<RecipientPolicyInput | null>(null);
  const [level, setLevel] = useState<DisclosureLevel>('trusted');
  const policy = draft ?? initial;
  const dirty = draft !== null;
  const mayPrepare = canPrepareCapsule(state, actor).ok;
  const neverPrepared = state.capsules.length === 0;
  const canSend = mayPrepare && (dirty || neverPrepared);

  const preview = owner ? actions.previewDisclosure(view.id, level, policy) : view.facts;
  const holders = state.recipients.filter((r) => (policy.levels[r.deviceId] ?? 'off') === level).map((r) => r.userName);

  const cycle = (deviceId: string) => {
    const current = policy.levels[deviceId] ?? 'off';
    const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] ?? 'off';
    setDraft({ ...policy, levels: { ...policy.levels, [deviceId]: next } });
  };

  const pill = neverPrepared ? { label: 'Not prepared', fg: colors.gray1, bg: colors.hairline } : dirty ? { label: 'Changes not sent', fg: colors.amberText, bg: colors.amberTint } : { label: 'Prepared', fg: colors.ink, bg: colors.hairline };

  return (
    <>
      <View>
        <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: '700', letterSpacing: -0.4, color: colors.ink }}>
          Privacy
        </Text>
        <Text style={{ fontSize: 14, color: colors.gray1, marginTop: 4 }}>Share what’s needed. Protect what isn’t.</Text>
      </View>

      <View testID="capsule-card" style={{ backgroundColor: '#FFFFFF', borderRadius: 22, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Icon name="lock" size={20} filled />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>Rescue Capsule</Text>
          <Text style={{ fontSize: 13, color: colors.gray1, marginTop: 1 }}>{mode === 'demo' ? 'Encryption simulated · receipts confirm delivery' : 'Each recipient reads only their level · receipts confirm delivery'}</Text>
        </View>
        <TagPill testID="capsule-state" label={pill.label} fg={pill.fg} bg={pill.bg} />
      </View>

      {owner ? <SegmentedControl options={PREVIEW_LEVELS} value={level} onChange={setLevel} accessibilityLabel="Preview what a level can read" fontSize={13} /> : null}

      <CardBox>
        <View style={{ paddingVertical: 12, paddingHorizontal: 16 }}>
          <Text testID="preview-who" style={{ fontSize: 13, color: colors.gray1 }}>
            {owner ? (holders.length > 0 ? `Seen by: ${holders.join(', ')}` : 'Nobody holds this level right now') : 'This is what your device can read'}
          </Text>
        </View>
        {preview.length === 0 ? (
          <View style={{ paddingVertical: 11, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: colors.hairline }}>
            <Text testID="preview-empty" style={{ fontSize: 13, lineHeight: 19, color: colors.gray1 }}>
              {owner && level === 'relay' ? 'Nothing. A device that only passes along handles sealed data and cannot read any detail.' : 'Nothing readable at this level.'}
            </Text>
          </View>
        ) : (
          preview.map((f) => <PreviewRow key={f.field} fact={f} />)
        )}
      </CardBox>

      {owner ? (
        <>
          <SectionTitle>Recipients</SectionTitle>
          <CardBox>
            {state.recipients.length === 0 ? (
              <View style={{ paddingVertical: 12, paddingHorizontal: 16 }}>
                <Text style={{ fontSize: 14, color: colors.gray1 }}>No trusted device paired when this request was created.</Text>
              </View>
            ) : (
              state.recipients.map((r, i) => {
                const current = policy.levels[r.deviceId] ?? 'off';
                const d = presentDelivery(r.capsuleDelivery);
                return (
                  <View key={r.deviceId} testID={`capsule-recipient-${r.deviceId}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
                    <Avatar name={r.userName} size={34} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>{r.userName}</Text>
                      <Text style={{ fontSize: 12, fontWeight: '500', color: DELIVERY_LOOK[r.capsuleDelivery].fg }}>Capsule: {d.label}</Text>
                    </View>
                    <Pressable
                      testID={`level-${r.deviceId}`}
                      accessibilityRole="button"
                      accessibilityLabel={`${r.userName}: ${LEVEL_LABELS[current]}. Change level`}
                      disabled={!mayPrepare}
                      onPress={() => cycle(r.deviceId)}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      style={{ minHeight: 32, paddingLeft: 12, paddingRight: 8, borderRadius: 999, backgroundColor: colors.hairline, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.ink }}>{LEVEL_SHORT[current]}</Text>
                      <Icon name="unfold_more" size={16} />
                    </Pressable>
                  </View>
                );
              })
            )}
          </CardBox>

          <CardBox>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 }}>
              <Text style={{ flex: 1, fontSize: 15, fontWeight: '500', color: colors.ink }}>Share detailed location</Text>
              <Toggle testID="toggle-location" label="Share detailed location" value={policy.shareDetailedLocation} disabled={!mayPrepare} onChange={(v) => setDraft({ ...policy, shareDetailedLocation: v })} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: colors.hairline }}>
              <Text style={{ flex: 1, fontSize: 15, fontWeight: '500', color: colors.ink }}>Share what I described</Text>
              <Toggle testID="toggle-description" label="Share what I described" value={policy.shareSymptoms} disabled={!mayPrepare} onChange={(v) => setDraft({ ...policy, shareSymptoms: v })} />
            </View>
          </CardBox>

          <Pill
            testID="capsule-send"
            label={neverPrepared ? 'Confirm capsule preparation' : dirty ? 'Send capsule update' : 'Capsule up to date'}
            h={54}
            size={16}
            press={0.98}
            disabled={!canSend || busy !== null}
            onPress={async () => {
              const r = await run('capsule', () => actions.updateCapsule(view.id, policy));
              if (r.ok) setDraft(null);
            }}
          />
          <Text style={{ fontSize: 12, lineHeight: 17, color: colors.gray1, paddingHorizontal: 4 }}>Sending queues the update on this device. Each recipient shows Delivered only after their device returns a receipt.</Text>
        </>
      ) : (
        <Text testID="my-access" style={{ fontSize: 13, color: colors.gray1, paddingHorizontal: 4 }}>
          Your access: {LEVEL_LABELS[view.access]}
        </Text>
      )}
    </>
  );
}
