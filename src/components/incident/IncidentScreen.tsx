import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { canAddReport } from '@/domain';
import { usePulse } from '@/services/PulseProvider';
import { Button, Screen, SegmentedControl } from '@/ui';

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

export function IncidentScreen({ incidentId, initialSegment = 'intelligence' }: { incidentId: string; initialSegment?: Segment }) {
  const snapshot = usePulse();
  const actor = useActor();
  const [segment, setSegment] = useState<Segment>(initialSegment);
  const view = snapshot.incidents.find((i) => i.id === incidentId);
  const back = () => (router.canGoBack() ? router.back() : router.replace(routes.home));

  if (!view) {
    return (
      <Screen onBack={back} title="Request not found" subtitle="This request is not on this device. It may have been deleted here, or it has not arrived yet.">
        <Button label="Go to Activity" variant="secondary" onPress={() => router.replace(routes.activity)} />
      </Screen>
    );
  }

  const mayReport = view.role === 'reporter' && canAddReport(view.state, actor, 'report').ok;

  return (
    <Screen testID="incident-screen" onBack={back} headerRight={<Text className="text-[14px] font-semibold text-gray-1">{view.shortId}</Text>}>
      <StatusCard view={view} me={actor} />
      {mayReport && view.state.reports.length === 0 ? (
        <Button testID="describe" label="Describe what happened" variant="secondary" size="md" icon="auto_awesome" onPress={() => router.push(routes.report(view.id))} accessibilityHint="Optional. Your request is already saved." />
      ) : null}
      <SegmentedControl options={SEGMENTS} value={segment} onChange={setSegment} accessibilityLabel="Incident sections" />
      <View>
        {segment === 'intelligence' ? <IntelligenceTab view={view} actor={actor} /> : null}
        {segment === 'coordination' ? <CoordinationTab view={view} actor={actor} /> : null}
        {segment === 'timeline' ? <TimelineTab view={view} actor={actor} /> : null}
        {segment === 'capsule' ? <CapsuleTab view={view} actor={actor} /> : null}
      </View>
    </Screen>
  );
}
