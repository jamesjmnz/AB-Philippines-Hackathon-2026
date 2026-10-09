import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Text, View } from 'react-native';

import type { IncidentView } from '@/services/api';
import { Banner, StepBar, colors, tones } from '@/ui';

import { IncidentMap } from '../map/IncidentMap';
import { presentStatus, presentSteps, type Me } from '../present';
import { TagPill } from './parts';

/**
 * Map / status card (design 426–472): white, radius 26, padding 8, the 17:9 map at radius 20, then the
 * title + pill, the sub-line and the five-step bar in a block padded 14/10/8 with 10pt gaps.
 */
export function StatusCard({ view, me }: { view: IncidentView; me: Me }) {
  const status = presentStatus(view.state, me);
  const steps = presentSteps(view.state);
  const tone = tones[status.tone];
  const cancelled = view.state.closure?.kind === 'cancelled';
  // VoiceOver: say a status change aloud when it happens (not on first render).
  const announced = useRef(status.title);
  useEffect(() => {
    if (announced.current === status.title) return;
    announced.current = status.title;
    AccessibilityInfo.announceForAccessibility(`${status.title}. ${status.sub}`);
  }, [status.title, status.sub]);
  return (
    <View testID="status-card" style={{ backgroundColor: '#FFFFFF', borderRadius: 26, padding: 8 }}>
      <IncidentMap view={view} radius={20} />
      <View style={{ paddingTop: 14, paddingHorizontal: 10, paddingBottom: 8, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <Text testID="status-title" accessibilityRole="header" accessibilityLiveRegion="polite" style={{ flex: 1, fontSize: 22, fontWeight: '700', letterSpacing: -0.6, lineHeight: 25.3, color: colors.ink }}>
            {status.title}
          </Text>
          <TagPill testID="status-chip" label={status.chip} fg={tone.fg} bg={tone.bg} />
        </View>
        <Text testID="status-sub" style={{ fontSize: 14, lineHeight: 20.3, color: colors.gray2 }}>
          {status.sub}
        </Text>
        {view.receivedViaName ? <Text style={{ fontSize: 12.5, color: colors.gray1 }}>Reached this device through {view.receivedViaName}.</Text> : null}
        {view.sendFailure === 'packet_too_large' ? (
          // Blocked, not waiting: the count line below would read as "will be delivered", so it gives way.
          <Banner testID="send-too-large" icon="warning" text="The latest update is too large to send. It has not gone out and is still on this device. Trying again will not send it." />
        ) : view.pendingOutbox > 0 ? (
          <Text style={{ fontSize: 12.5, color: colors.gray1 }}>
            {view.pendingOutbox} {view.pendingOutbox === 1 ? 'update is' : 'updates are'} waiting on this device to be delivered.
          </Text>
        ) : null}
        <View style={{ marginTop: 4 }}>
          <StepBar steps={steps} color={cancelled ? colors.gray5 : status.ring} />
        </View>
      </View>
    </View>
  );
}
