import { useLocalSearchParams } from 'expo-router';

import { ReportScreen } from '@/components/report/ReportScreen';

export default function ReportRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ReportScreen incidentId={id} />;
}
