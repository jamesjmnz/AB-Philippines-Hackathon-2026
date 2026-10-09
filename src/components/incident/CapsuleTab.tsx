import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { canPrepareCapsule, type Actor, type DisclosureLevel } from '@/domain';
import type { FactView, IncidentView, RecipientPolicyInput } from '@/services/api';
import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Avatar, Button, Chip, GroupedList, Icon, SectionHeader, SegmentedControl, Toggle, colors } from '@/ui';

import { FIELD_LABELS, LEVEL_LABELS, LEVEL_SHORT, presentDelivery } from '../present';
import { useRun } from './useRun';

const ORDER: readonly (DisclosureLevel | 'off')[] = ['off', 'relay', 'trusted', 'authorized'];
const PREVIEW_LEVELS = [
  { key: 'relay', label: 'Passes along' },
  { key: 'trusted', label: 'Summary' },
  { key: 'authorized', label: 'Everything' },
] as const;

function PreviewRow({ fact }: { fact: FactView }) {
  const readable = !fact.protected;
  const value = readable ? (fact.value ?? 'Unknown') : 'Protected';
  return (
    <View
      testID={`preview-${fact.field}`}
      accessible
      accessibilityLabel={`${FIELD_LABELS[fact.field]}: ${readable ? value : 'protected, not readable at this level'}`}
      className="flex-row items-center gap-3 border-t border-hairline px-4 py-[11px]">
      <Icon name={readable ? 'visibility' : 'lock'} size={17} color={readable ? colors.ink : colors.gray4} />
      <Text className="flex-1 text-[13px] text-gray-1">{FIELD_LABELS[fact.field]}</Text>
      <Text className={`max-w-[55%] text-right text-[14px] font-semibold ${readable && fact.value !== null ? 'text-ink' : 'text-gray-4'}`}>{value}</Text>
    </View>
  );
}

/** The design's Privacy page: preview per level, recipients with delivery state, share toggles, send. */
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

  const preview = owner ? actions.previewDisclosure(view.id, level, policy) : view.facts;
  const holders = state.recipients.filter((r) => (policy.levels[r.deviceId] ?? 'off') === level).map((r) => r.userName);

  const cycle = (deviceId: string) => {
    const current = policy.levels[deviceId] ?? 'off';
    const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] ?? 'off';
    setDraft({ ...policy, levels: { ...policy.levels, [deviceId]: next } });
  };

  return (
    <View className="gap-[14px]">
      <View>
        <Text accessibilityRole="header" className="text-[26px] font-bold tracking-[-0.7px] text-ink">
          Privacy
        </Text>
        <Text className="mt-1 text-[14px] text-gray-1">Share what’s needed. Protect what isn’t.</Text>
      </View>

      <View className="flex-row items-center gap-3 rounded-card bg-card px-4 py-[14px]">
        <Icon name="lock" size={20} filled />
        <View className="flex-1">
          <Text className="text-[15px] font-semibold text-ink">Rescue Capsule</Text>
          <Text className="mt-[1px] text-[12.5px] leading-[17px] text-gray-1">
            {mode === 'demo' ? 'Encryption simulated · ' : ''}Each recipient reads only their level · delivery is shown only from receipts
          </Text>
        </View>
        <Chip label={neverPrepared ? 'Not prepared' : dirty ? 'Changes not sent' : 'Prepared'} tone={neverPrepared || dirty ? 'amber' : 'neutral'} />
      </View>

      {owner ? <SegmentedControl options={PREVIEW_LEVELS} value={level} onChange={setLevel} accessibilityLabel="Preview what a level can read" /> : null}

      <GroupedList>
        <View className="px-4 py-3">
          <Text testID="preview-who" className="text-[12.5px] text-gray-1">
            {owner ? (holders.length > 0 ? `Seen by: ${holders.join(', ')}` : 'Nobody holds this level right now') : 'This is what your device can read'}
          </Text>
        </View>
        {preview.length === 0 ? (
          <View className="border-t border-hairline px-4 py-3">
            <Text testID="preview-empty" className="text-[13.5px] text-gray-1">
              {owner && level === 'relay' ? 'Nothing. A device that only passes along handles sealed data and cannot read any detail.' : 'Nothing readable at this level.'}
            </Text>
          </View>
        ) : (
          preview.map((f) => <PreviewRow key={f.field} fact={f} />)
        )}
      </GroupedList>

      {owner ? (
        <>
          <View>
            <SectionHeader title="Recipients" />
            <GroupedList>
              {state.recipients.length === 0 ? (
                <View className="px-4 py-4">
                  <Text className="text-[14px] text-gray-1">No trusted device paired when this request was created.</Text>
                </View>
              ) : (
                state.recipients.map((r, i) => {
                  const current = policy.levels[r.deviceId] ?? 'off';
                  const d = presentDelivery(r.capsuleDelivery);
                  return (
                    <View key={r.deviceId} testID={`capsule-recipient-${r.deviceId}`} className={`flex-row items-center gap-3 px-4 py-3 ${i === 0 ? '' : 'border-t border-hairline'}`}>
                      <Avatar name={r.userName} size={34} />
                      <View className="flex-1">
                        <Text className="text-[15px] font-semibold text-ink">{r.userName}</Text>
                        <Text className="text-[12px] font-medium" style={{ color: d.tone === 'green' ? colors.greenText : d.tone === 'amber' ? colors.amberText : colors.gray1 }}>
                          Capsule: {d.label}
                        </Text>
                      </View>
                      <Pressable
                        testID={`level-${r.deviceId}`}
                        accessibilityRole="button"
                        accessibilityLabel={`${r.userName}: ${LEVEL_LABELS[current]}. Change level`}
                        disabled={!mayPrepare}
                        onPress={() => cycle(r.deviceId)}
                        hitSlop={6}
                        className="min-h-[36px] flex-row items-center gap-1 rounded-full bg-fill-pill px-3">
                        <Text className="text-[13px] font-semibold text-ink">{LEVEL_SHORT[current]}</Text>
                        <Icon name="unfold_more" size={15} color={colors.gray2} />
                      </Pressable>
                    </View>
                  );
                })
              )}
            </GroupedList>
          </View>

          <GroupedList>
            <View className="flex-row items-center gap-3 px-4 py-3">
              <View className="flex-1">
                <Text className="text-[15px] font-medium text-ink">Share detailed location</Text>
                <Text className="mt-0.5 text-[12.5px] text-gray-1">Off: recipients read the building only.</Text>
              </View>
              <Toggle testID="toggle-location" label="Share detailed location" value={policy.shareDetailedLocation} disabled={!mayPrepare} onChange={(v) => setDraft({ ...policy, shareDetailedLocation: v })} />
            </View>
            <View className="flex-row items-center gap-3 border-t border-hairline px-4 py-3">
              <View className="flex-1">
                <Text className="text-[15px] font-medium text-ink">Share what I described</Text>
                <Text className="mt-0.5 text-[12.5px] text-gray-1">Off: nobody else reads your description or your original words.</Text>
              </View>
              <Toggle testID="toggle-description" label="Share what I described" value={policy.shareSymptoms} disabled={!mayPrepare} onChange={(v) => setDraft({ ...policy, shareSymptoms: v })} />
            </View>
          </GroupedList>

          <Button
            testID="capsule-send"
            label={neverPrepared ? 'Prepare and queue capsule' : 'Send capsule update'}
            size="md"
            disabled={!mayPrepare || busy !== null || (!dirty && !neverPrepared)}
            onPress={async () => {
              const r = await run('capsule', () => actions.updateCapsule(view.id, policy));
              if (r.ok) setDraft(null);
            }}
          />
          <Text className="px-1 text-[12px] leading-[17px] text-gray-1">
            Sending queues the update on this device. Each recipient shows Delivered only after their device returns a receipt.
          </Text>
        </>
      ) : (
        <Text testID="my-access" className="px-1 text-[13px] text-gray-1">
          Your access: {LEVEL_LABELS[view.access]}
        </Text>
      )}
    </View>
  );
}
