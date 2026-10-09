import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { IncidentView } from '@/services/api';
import { usePulse } from '@/services/PulseProvider';
import { Enter, Icon, colors, tabBarHeight, tones, type IconName } from '@/ui';

import { useActor } from '../incident/useMe';
import { routes } from '../nav';
import { displayName, incidentHeadline, incidentPlace, presentStatus, whenLabel } from '../present';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'awaiting', label: 'Awaiting Response' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'cancelled', label: 'Cancelled' },
] as const;
type Filter = (typeof FILTERS)[number]['key'];

function matches(view: IncidentView, filter: Filter): boolean {
  const s = view.state;
  switch (filter) {
    case 'all':
      return true;
    case 'active':
      return s.closure === null;
    case 'awaiting':
      return s.closure === null && (s.status.status === 'queued' || s.status.status === 'delivered' || s.status.status === 'acknowledged');
    case 'resolved':
      return s.closure?.kind === 'resolved';
    case 'cancelled':
      return s.closure?.kind === 'cancelled';
  }
}

type ChipDef = { icon: IconName; label: string; fg: string; bg: string };

/** Activity (design 360–384): filter pills, search, incident cards, empty state. */
export function ActivityScreen() {
  const snapshot = usePulse();
  const actor = useActor();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const q = search.trim().toLowerCase();
  const list = snapshot.incidents
    .filter((v) => matches(v, filter))
    .filter((v) => {
      if (q.length === 0) return true;
      const haystack = [v.shortId, incidentHeadline(v, actor), incidentPlace(v) ?? '', v.state.incident?.reporter.userName ?? '', ...v.state.recipients.map((r) => r.userName)].join(' ').toLowerCase();
      return haystack.includes(q);
    })
    .sort((a, b) => (b.state.incident?.createdAtMs ?? 0) - (a.state.incident?.createdAtMs ?? 0));

  return (
    <View testID="activity-screen" style={{ flex: 1, backgroundColor: colors.page, paddingTop: insets.top }}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: tabBarHeight(insets.bottom) + 30 }}>
        <Enter kind="fadeUp" duration={350} style={{ paddingTop: 8, paddingHorizontal: 20, gap: 16 }}>
          <Text accessibilityRole="header" style={{ fontSize: 30, fontWeight: '700', letterSpacing: -0.9, color: colors.ink, paddingTop: 6 }}>
            Activity
          </Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
            {FILTERS.map((f) => {
              const selected = filter === f.key;
              return (
                <Pressable
                  key={f.key}
                  testID={`filter-${f.key}`}
                  accessibilityRole="button"
                  accessibilityLabel={f.label}
                  accessibilityState={{ selected }}
                  onPress={() => setFilter(f.key)}
                  hitSlop={{ top: 4, bottom: 4 }}
                  style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 15, borderRadius: 999, borderWidth: 1, borderColor: selected ? colors.ink : colors.lineInput, backgroundColor: selected ? colors.ink : '#FFFFFF' }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: selected ? '#FFFFFF' : colors.ink }}>{f.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, borderRadius: 14, backgroundColor: colors.fillSeg, paddingHorizontal: 12 }}>
            <Icon name="search" size={20} color={colors.gray1} />
            <TextInput
              testID="activity-search"
              accessibilityLabel="Search incidents, places, people"
              value={search}
              onChangeText={setSearch}
              placeholder="Search incidents, places, people"
              placeholderTextColor={colors.gray1}
              returnKeyType="search"
              style={{ flex: 1, minWidth: 0, paddingVertical: 0, fontSize: 16, color: colors.ink }}
            />
          </View>

          <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '700', color: colors.ink, marginTop: 4 }}>
            Incidents
          </Text>

          <View style={{ gap: 10 }}>
            {list.map((view) => {
              const status = presentStatus(view.state, actor);
              const tone = tones[status.tone];
              const reporter = view.state.incident?.reporter;
              const reporterId = reporter?.deviceId ?? null;
              const held = view.state.tasks.filter((t) => t.assignee !== null && t.assignee.deviceId !== reporterId && t.status !== 'offered' && t.status !== 'unassigned');
              const helpers = [...new Set(held.map((t) => (t.assignee ? displayName(actor, t.assignee.deviceId, t.assignee.userName) : '')))].filter(Boolean);
              const reporterName = reporter ? displayName(actor, reporter.deviceId, reporter.userName) : 'Unknown';
              const created = view.state.incident?.createdAtMs;
              const open = view.state.closure === null;
              const conflicts = view.state.contradictions.filter((c) => c.status === 'open').length;
              const chips: ChipDef[] = [];
              if (held.length > 0) chips.push({ icon: 'task_alt', label: `${held.length} ${held.length === 1 ? 'role' : 'roles'} taken`, fg: colors.greenText, bg: colors.greenTint });
              if (conflicts > 0) chips.push({ icon: 'call_split', label: `${conflicts} conflict`, fg: colors.coralText, bg: colors.coralTint });
              if (open && view.state.capsules.length > 0) chips.push({ icon: 'lock', label: 'Capsule', fg: colors.ink, bg: colors.hairline });
              return (
                <Enter key={view.id} kind="fadeUp" duration={300}>
                  <Pressable
                    testID={`incident-${view.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${incidentHeadline(view, actor)}, ${view.shortId}, ${status.chip}`}
                    onPress={() => router.push(routes.incident(view.id))}
                    style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14, backgroundColor: '#FFFFFF', borderRadius: 22, paddingVertical: 14, paddingHorizontal: 16 }}>
                    <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: tone.bg, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name={status.icon} size={22} color={tone.fg} filled />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                        <Text style={{ flex: 1, fontSize: 16, fontWeight: '600', color: colors.ink }}>{incidentHeadline(view, actor)}</Text>
                        {created !== undefined ? <Text style={{ fontSize: 12, color: colors.gray1 }}>{whenLabel(created)}</Text> : null}
                      </View>
                      <Text style={{ fontSize: 13, color: colors.gray1, marginTop: 3 }}>
                        {view.shortId} · {incidentPlace(view) ?? 'Location not stated'}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 9 }}>
                        <Text style={{ flex: 1, fontSize: 12.5, color: colors.gray2 }}>{helpers.length > 0 ? `${reporterName} → ${helpers.join(', ')}` : reporterName}</Text>
                        <View style={{ backgroundColor: tone.bg, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 9 }}>
                          <Text numberOfLines={1} style={{ fontSize: 11.5, fontWeight: '700', color: tone.fg }}>
                            {status.chip}
                          </Text>
                        </View>
                      </View>
                      {chips.length > 0 ? (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                          {chips.map((c) => (
                            <View key={c.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.bg, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 8 }}>
                              <Icon name={c.icon} size={14} color={c.fg} />
                              <Text style={{ fontSize: 11.5, fontWeight: '600', color: c.fg }}>{c.label}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  </Pressable>
                </Enter>
              );
            })}
            {list.length === 0 ? (
              <View testID="activity-empty" style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 }}>
                <Icon name="inbox" size={36} color={colors.gray1} />
                <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink, marginTop: 10 }}>No incidents found</Text>
                <Text style={{ fontSize: 13, color: colors.gray1, marginTop: 4, textAlign: 'center' }}>
                  {snapshot.incidents.length > 0 ? 'Try a different search or filter.' : 'Requests you send or receive are kept on this device and listed here.'}
                </Text>
              </View>
            ) : null}
          </View>
        </Enter>
      </ScrollView>
    </View>
  );
}
