import { Text, View } from 'react-native';

import type { IncidentView } from '@/services/api';
import { usePulse } from '@/services/PulseProvider';
import { Pill, Sheet, colors } from '@/ui';

import { FIELD_LABELS, whenLabel } from '../present';
import { SheetRow } from './parts';

const CAPS = { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, color: colors.gray1, textTransform: 'uppercase' } as const;

/** Incident details sheet (design 809–825). Rows come from `view.facts`; there is no severity row. */
export function DetailsSheet({ view, visible, onClose }: { view: IncidentView; visible: boolean; onClose: () => void }) {
  const { mode } = usePulse();
  const incident = view.state.incident;
  const type = view.facts.find((f) => f.field === 'incidentType');
  const headline = type && !type.protected && type.value ? type.value : 'Assistance request';
  const ai = view.state.aiFindings.length === 0 ? 'Not used' : mode === 'demo' ? 'Simulated' : 'On this device';
  return (
    <Sheet testID="details-sheet" visible={visible} onClose={onClose}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.gray1 }}>
        {view.shortId}
        {incident ? ` · ${whenLabel(incident.createdAtMs)}` : ''}
      </Text>
      <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: '800', letterSpacing: -0.8, color: colors.ink, marginTop: 4 }}>
        {headline}
      </Text>
      {view.originalReport !== null ? (
        <View style={{ marginTop: 16 }}>
          <Text style={CAPS}>Original report</Text>
          <View style={{ backgroundColor: colors.page, borderRadius: 16, padding: 14, marginTop: 8 }}>
            <Text testID="details-report" style={{ fontSize: 15, lineHeight: 21.75, color: colors.ink }}>
              “{view.originalReport}”
            </Text>
          </View>
        </View>
      ) : null}
      <Text style={[CAPS, { marginTop: 18 }]}>Structured record</Text>
      <View style={{ marginTop: 6 }}>
        {view.facts.map((f) => (
          <SheetRow key={f.field} testID={`details-${f.field}`} label={FIELD_LABELS[f.field]} value={f.protected ? 'Protected' : (f.value ?? 'Unknown')} />
        ))}
        <SheetRow testID="details-source" label="Source" value={incident?.source === 'guided_report' ? 'Guided report' : 'Manual SOS'} />
        <SheetRow testID="details-ai" label="AI processing" value={ai} />
        <SheetRow testID="details-reporter" label="Reporter" value={incident?.reporter.userName ?? 'Unknown'} />
      </View>
      <View style={{ marginTop: 20 }}>
        <Pill testID="details-done" label="Done" h={54} size={16} onPress={onClose} />
      </View>
    </Sheet>
  );
}
