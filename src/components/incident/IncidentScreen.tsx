import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePulse } from '@/services/PulseProvider';
import { Enter, IconButton, Pill, SegmentedControl, colors, padBottom } from '@/ui';

import { routes } from '../nav';
import { CapsuleTab } from './CapsuleTab';
import { CoordinationTab } from './CoordinationTab';
import { IntelligenceTab } from './IntelligenceTab';
import { StatusCard } from './StatusCard';
import { TimelineTab } from './TimelineTab';
import { useActor } from './useMe';

const SEGMENTS = [
  { key: 'intelligence', label: 'Intelligence' },
  { key: 'coordination', label: 'Coordination' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'capsule', label: 'Capsule' },
] as const;
type Segment = (typeof SEGMENTS)[number]['key'];

/**
 * Incident detail (design 416–595). The design's header, map/status card and step bar stay on top;
 * the product's four segments sit directly under the card in the design's own segmented style, and the
 * design's sections are distributed between them.
 */
export function IncidentScreen({ incidentId, initialSegment = 'intelligence' }: { incidentId: string; initialSegment?: Segment }) {
  const snapshot = usePulse();
  const actor = useActor();
  const insets = useSafeAreaInsets();
  const [segment, setSegment] = useState<Segment>(initialSegment);
  const view = snapshot.incidents.find((i) => i.id === incidentId);
  const back = () => (router.canGoBack() ? router.back() : router.replace(routes.home));

  return (
    <View testID="incident-screen" style={{ flex: 1, backgroundColor: colors.page, paddingTop: insets.top }}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: padBottom(insets.bottom, 44) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, paddingHorizontal: 20 }}>
          <IconButton testID="incident-back" icon="arrow_back" label="Back" size={40} onPress={back} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.gray1 }}>{view?.shortId ?? ''}</Text>
          <View style={{ width: 40 }} />
        </View>

        {view ? (
          <Enter kind="fadeUp" duration={300} style={{ paddingTop: 14, paddingHorizontal: 20, gap: 14 }}>
            <StatusCard view={view} me={actor} />
            <SegmentedControl options={SEGMENTS} value={segment} onChange={setSegment} accessibilityLabel="Incident sections" fontSize={13} />
            {segment === 'intelligence' ? <IntelligenceTab view={view} actor={actor} /> : null}
            {segment === 'coordination' ? <CoordinationTab view={view} actor={actor} /> : null}
            {segment === 'timeline' ? <TimelineTab view={view} actor={actor} /> : null}
            {segment === 'capsule' ? <CapsuleTab view={view} actor={actor} /> : null}
          </Enter>
        ) : (
          <View testID="incident-missing" style={{ paddingTop: 14, paddingHorizontal: 20, gap: 14 }}>
            <View>
              <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: '700', letterSpacing: -0.7, color: colors.ink }}>
                Request not found
              </Text>
              <Text style={{ fontSize: 14, lineHeight: 20.3, color: colors.gray1, marginTop: 4 }}>This request is not on this device. It may have been deleted here, or it has not arrived yet.</Text>
            </View>
            <Pill label="Go to Activity" tone="soft" h={54} size={16} onPress={() => router.replace(routes.activity)} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}
