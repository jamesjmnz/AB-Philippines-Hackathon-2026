import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Text, View } from 'react-native';

import type { IncidentView } from '@/services/api';
import { Chip, Icon, StepBar, colors } from '@/ui';

import { incidentPlace, presentStatus, presentSteps, type Me } from '../present';

/**
 * Status title, chip, sub-text and the five-step bar. There is no map: in place of one, a neutral
 * card repeats the location in the words that were reported, or says it is unknown or protected.
 */
export function StatusCard({ view, me }: { view: IncidentView; me: Me }) {
  const status = presentStatus(view.state, me);
  const steps = presentSteps(view.state);
  const place = incidentPlace(view);
  // VoiceOver: say a status change aloud when it happens (not on first render).
  const announced = useRef(status.title);
  useEffect(() => {
    if (announced.current === status.title) return;
    announced.current = status.title;
    AccessibilityInfo.announceForAccessibility(`${status.title}. ${status.sub}`);
  }, [status.title, status.sub]);
  const locationProtected = view.facts.some((f) => (f.field === 'floor' || f.field === 'locationText') && f.protected);
  return (
    <View testID="status-card" className="gap-[10px] rounded-[26px] bg-card p-[18px]">
      <View className="flex-row items-center gap-2 rounded-2xl bg-page px-3 py-[10px]">
        <Icon name={place === null && locationProtected ? 'lock' : 'location_on'} size={18} color={colors.gray2} />
        <Text testID="status-place" className="flex-1 text-[13.5px] font-semibold text-gray-3">
          {place ?? (locationProtected ? 'Location protected on this device' : 'Location not reported')}
        </Text>
        {place !== null ? <Text className="text-[11.5px] text-gray-4">as reported</Text> : null}
      </View>
      <View className="flex-row items-start justify-between gap-[10px]">
        <Text testID="status-title" accessibilityRole="header" accessibilityLiveRegion="polite" className="flex-1 text-[22px] font-bold leading-[26px] tracking-[-0.6px] text-ink">
          {status.title}
        </Text>
        <View testID="status-chip">
          <Chip label={status.chip} tone={status.tone} />
        </View>
      </View>
      <Text testID="status-sub" className="text-[14px] leading-[20px] text-gray-2">
        {status.sub}
      </Text>
      {view.receivedViaName ? <Text className="text-[12.5px] text-gray-1">Reached this device through {view.receivedViaName}.</Text> : null}
      {view.pendingOutbox > 0 ? (
        <Text className="text-[12.5px] text-gray-1">
          {view.pendingOutbox} {view.pendingOutbox === 1 ? 'update is' : 'updates are'} waiting on this device to be delivered.
        </Text>
      ) : null}
      <View className="mt-1">
        <StepBar steps={steps} />
      </View>
    </View>
  );
}
