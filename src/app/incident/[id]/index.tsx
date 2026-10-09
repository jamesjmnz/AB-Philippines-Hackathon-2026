import { useLocalSearchParams } from 'expo-router';

import { IncidentScreen } from '@/components/incident/IncidentScreen';

export default function IncidentRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <IncidentScreen incidentId={id} />;
}
