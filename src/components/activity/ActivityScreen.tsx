import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import type { IncidentView } from '@/services/api';
import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Chip, ChoiceChip, Dialog, Icon, Screen, TextButton, colors, tones } from '@/ui';

import { useActor } from '../incident/useMe';
import { routes } from '../nav';
import { incidentHeadline, incidentPlace, presentStatus, timeLabel } from '../present';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'mine', label: 'My requests' },
  { key: 'responding', label: 'Received' },
  { key: 'closed', label: 'Closed' },
] as const;
type Filter = (typeof FILTERS)[number]['key'];

function matches(view: IncidentView, filter: Filter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'open':
      return view.state.closure === null;
    case 'closed':
      return view.state.closure !== null;
    case 'mine':
      return view.role === 'reporter';
    case 'responding':
      return view.role === 'responder';
  }
}

export function ActivityScreen() {
  const snapshot = usePulse();
  const actions = usePulseActions();
  const actor = useActor();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [confirming, setConfirming] = useState(false);

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
    <Screen testID="activity-screen" tabbed title="Activity">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
        {FILTERS.map((f) => (
          <ChoiceChip key={f.key} testID={`filter-${f.key}`} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </ScrollView>
      <View className="min-h-[44px] flex-row items-center gap-2 rounded-[14px] bg-fill-seg px-3">
        <Icon name="search" size={20} color={colors.gray1} />
        <TextInput
          testID="activity-search"
          accessibilityLabel="Search incidents, places, people"
          value={search}
          onChangeText={setSearch}
          placeholder="Search incidents, places, people"
          placeholderTextColor={colors.gray1}
          returnKeyType="search"
          className="flex-1 py-2 text-[16px] text-ink"
        />
      </View>

      <Text accessibilityRole="header" className="mt-1 text-[17px] font-bold text-ink">
        Incidents
      </Text>
      <View className="gap-[10px]">
        {list.map((view) => {
          const status = presentStatus(view.state, actor);
          const tone = tones[status.tone];
          const helpers = view.state.tasks.filter((t) => t.assignee !== null).length;
          const created = view.state.incident?.createdAtMs;
          return (
            <Pressable
              key={view.id}
              testID={`incident-${view.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${incidentHeadline(view, actor)}, ${view.shortId}, ${status.title}`}
              onPress={() => router.push(routes.incident(view.id))}
              className="flex-row items-start gap-[14px] rounded-card bg-card px-4 py-[14px] active:opacity-80">
              <View className="h-11 w-11 items-center justify-center rounded-[14px]" style={{ backgroundColor: tone.bg }}>
                <Icon name={view.role === 'reporter' ? 'sos' : 'volunteer_activism'} size={22} color={tone.fg} filled />
              </View>
              <View className="flex-1">
                <View className="flex-row justify-between gap-2">
                  <Text className="flex-1 text-[16px] font-semibold text-ink">{incidentHeadline(view, actor)}</Text>
                  {created !== undefined ? <Text className="text-[12px] text-gray-1">{timeLabel(created)}</Text> : null}
                </View>
                <Text className="mt-[3px] text-[13px] text-gray-1">
                  {view.shortId} · {incidentPlace(view) ?? 'Location not reported or not shared'}
                </Text>
                <View className="mt-[9px] flex-row items-center justify-between gap-2">
                  <Text className="flex-1 text-[12.5px] text-gray-2">
                    {view.state.recipients.length} {view.state.recipients.length === 1 ? 'recipient' : 'recipients'} · {helpers} {helpers === 1 ? 'role taken' : 'roles taken'}
                  </Text>
                  <Chip label={status.chip} tone={status.tone} />
                </View>
              </View>
            </Pressable>
          );
        })}
        {list.length === 0 ? (
          <View testID="activity-empty" className="items-center px-5 py-10">
            <Icon name="inbox" size={36} color={colors.gray1} />
            <Text className="mt-[10px] text-[16px] font-semibold text-ink">No incidents found</Text>
            <Text className="mt-1 text-center text-[13px] text-gray-1">
              {snapshot.incidents.length === 0 ? 'Requests you send or receive are kept on this device and listed here.' : 'Nothing matches this filter or search.'}
            </Text>
          </View>
        ) : null}
      </View>

      {snapshot.incidents.length > 0 ? <TextButton testID="delete-all" label="Delete all incidents on this device" tone="coral" onPress={() => setConfirming(true)} /> : null}
      <Dialog
        visible={confirming}
        title="Delete all incidents here?"
        message="This removes every request and its history from this device only. Copies already delivered to other devices are not deleted. Your identity and pairings stay."
        cancelLabel="Keep"
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void actions.deleteAllIncidents();
        }}
      />
    </Screen>
  );
}
