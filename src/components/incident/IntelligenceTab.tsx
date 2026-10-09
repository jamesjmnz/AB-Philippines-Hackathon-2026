import { useState } from 'react';
import { Text, View } from 'react-native';

import { CLARIFIABLE_FIELDS, type ClarifiableField } from '@/ai';
import { canAddReport, canRequestClarification, canResolveConflict, canSkipClarification, type Actor, type ClaimField } from '@/domain';
import type { FactView, IncidentView } from '@/services/api';
import { usePulseActions } from '@/services/PulseProvider';
import { Banner, Button, Chip, GroupedList, Icon, ListRow, SectionHeader, Sheet, TextField, colors } from '@/ui';

import { FIELD_LABELS, PROVENANCE } from '../present';
import { useRun } from './useRun';

function isClarifiable(field: ClaimField): field is ClarifiableField {
  return (CLARIFIABLE_FIELDS as readonly string[]).includes(field);
}

export function ProvenanceChip({ tag }: { tag: FactView['tag'] }) {
  const p = PROVENANCE[tag];
  return <Chip label={p.label} tone={p.tone} solid={p.solid} />;
}

export function FactRow({ fact, first }: { fact: FactView; first: boolean }) {
  const label = FIELD_LABELS[fact.field];
  const value = fact.protected ? 'Protected' : fact.tag === 'unresolved' ? 'Two statements disagree' : (fact.value ?? 'Unknown');
  return (
    <View
      testID={`fact-${fact.field}`}
      accessible
      accessibilityLabel={`${label}: ${value}. ${fact.protected ? 'Not readable on this device' : PROVENANCE[fact.tag].label}`}
      className={`flex-row items-center gap-3 px-4 py-3 ${first ? '' : 'border-t border-hairline'}`}>
      <View className="flex-1">
        <Text className="text-[12px] text-gray-1">{label}</Text>
        <Text className={`mt-[1px] text-[15px] font-semibold ${fact.protected || fact.value === null ? 'text-gray-1' : 'text-ink'}`}>{value}</Text>
        {fact.evidence && !fact.protected ? <Text className="mt-0.5 text-[12.5px] italic text-gray-1">“{fact.evidence}”</Text> : null}
        {fact.by && !fact.protected && fact.value !== null ? <Text className="mt-0.5 text-[12px] text-gray-4">Said by {fact.by}</Text> : null}
      </View>
      {fact.protected ? (
        <View testID={`fact-lock-${fact.field}`} className="flex-row items-center gap-1 rounded-full bg-hairline px-[9px] py-1">
          <Icon name="lock" size={13} color={colors.gray1} />
          <Text className="text-[12px] font-semibold text-gray-1">protected</Text>
        </View>
      ) : (
        <ProvenanceChip tag={fact.tag} />
      )}
    </View>
  );
}

function ConflictCard({ view, actor, fact, conflictId }: { view: IncidentView; actor: Actor; fact: FactView; conflictId: string }) {
  const actions = usePulseActions();
  const { busy, run } = useRun();
  const [asked, setAsked] = useState(false);
  const mayResolve = canResolveConflict(view.state, actor, conflictId).ok;
  const mayAsk = canRequestClarification(view.state, actor).ok;
  return (
    <View testID={`conflict-${fact.field}`} className="gap-3 rounded-feature border border-amber bg-card p-[18px]">
      <View className="flex-row items-center gap-1.5">
        <Icon name="warning" size={16} color={colors.amberText} />
        <Text className="text-[12px] font-bold text-amber-text">Statements disagree · {FIELD_LABELS[fact.field]}</Text>
      </View>
      <Text className="text-[13.5px] leading-[19px] text-gray-2">Both statements are kept. Only the requester can say which one is right.</Text>
      {fact.candidates.map((c) => (
        <View key={`${c.by}-${c.value}`} testID={`conflict-value-${c.value}`} className="gap-2 rounded-2xl bg-page p-3">
          <Text className="text-[16px] font-bold text-ink">{c.value}</Text>
          <Text className="text-[12.5px] text-gray-1">Said by {c.by}</Text>
          {mayResolve ? (
            <Button
              testID={`conflict-pick-${c.value}`}
              label={`Keep “${c.value}”`}
              size="sm"
              disabled={busy !== null}
              onPress={() => void run('resolve', () => actions.resolveConflict(view.id, conflictId, c.value))}
            />
          ) : null}
        </View>
      ))}
      {!mayResolve && mayAsk ? (
        asked ? (
          <Text accessibilityLiveRegion="polite" className="text-[13px] font-semibold text-gray-2">
            Clarification requested from the requester. It is recorded on this device and sent when a link is open.
          </Text>
        ) : (
          <Button
            testID="conflict-ask"
            label="Request clarification"
            variant="secondary"
            size="sm"
            disabled={busy !== null}
            onPress={async () => {
              const r = await run('ask', () => actions.requestConflictClarification(view.id, conflictId));
              if (r.ok) setAsked(true);
            }}
          />
        )
      ) : null}
    </View>
  );
}

function ClarificationCard({ view, actor, questionId }: { view: IncidentView; actor: Actor; questionId: string }) {
  const actions = usePulseActions();
  const { busy, run } = useRun();
  const [answer, setAnswer] = useState('');
  const question = view.state.questions.find((q) => q.id === questionId);
  if (!question) return null;
  const field = question.field;
  const mayAnswer = canSkipClarification(view.state, actor, questionId).ok && isClarifiable(field);
  return (
    <View testID="clarification-card" className="gap-3 rounded-feature border border-indigo-line bg-card p-[18px]">
      <View className="flex-row items-center gap-1.5">
        <Icon name={question.origin === 'ai' ? 'auto_awesome' : 'help'} size={16} color={colors.indigo} />
        <Text className="text-[12px] font-bold text-indigo">
          {question.origin === 'ai' ? 'Suggested by AI · ' : ''}Missing detail · {FIELD_LABELS[field]}
        </Text>
      </View>
      <Text className="text-[16px] leading-[22px] text-gray-3">“{question.prompt}”</Text>
      {mayAnswer && isClarifiable(field) ? (
        <>
          <TextField testID="clarification-answer" label="Your answer" placeholder="Type an answer" value={answer} onChangeText={setAnswer} />
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button label="Skip" variant="secondary" size="sm" disabled={busy !== null} onPress={() => void run('skip', () => actions.skipClarification(view.id, field))} />
            </View>
            <View className="flex-1">
              <Button
                testID="clarification-submit"
                label="Add answer"
                size="sm"
                disabled={busy !== null || answer.trim().length === 0}
                onPress={() => void run('answer', () => actions.answerClarification(view.id, field, answer.trim()))}
              />
            </View>
          </View>
          <Text className="text-[12px] text-gray-1">Optional. Skipping leaves this detail unknown.</Text>
        </>
      ) : (
        <Text className="text-[13px] text-gray-1">Waiting for the requester. Only they can answer or skip it.</Text>
      )}
    </View>
  );
}

export function IntelligenceTab({ view, actor }: { view: IncidentView; actor: Actor }) {
  const actions = usePulseActions();
  const { busy, run } = useRun();
  const [observing, setObserving] = useState(false);
  const [text, setText] = useState('');
  const conflicts = view.state.contradictions.filter((c) => c.status === 'open');
  const questions = view.state.questions.filter((q) => q.status === 'open');
  const hasProtected = view.facts.some((f) => f.protected);
  const mayObserve = canAddReport(view.state, actor, 'observation').ok;
  const hasAI = view.facts.some((f) => f.tag === 'ai_proposed');

  return (
    <View className="gap-[14px]">
      {conflicts.map((c) => {
        const fact = view.facts.find((f) => f.field === c.field);
        return fact ? <ConflictCard key={c.id} view={view} actor={actor} fact={fact} conflictId={c.id} /> : null;
      })}
      {questions.slice(0, 1).map((q) => (
        <ClarificationCard key={q.id} view={view} actor={actor} questionId={q.id} />
      ))}

      <View>
        <SectionHeader title="Details" />
        <GroupedList>
          {view.facts.map((f, i) => (
            <FactRow key={f.field} fact={f} first={i === 0} />
          ))}
          {hasProtected ? (
            <View className="flex-row items-center gap-2 border-t border-hairline px-4 py-[11px]">
              <Icon name="lock" size={15} color={colors.gray2} />
              <Text className="flex-1 text-[12.5px] text-gray-2">Protected details were not shared with this device. They are not hidden by the app; this device cannot read them.</Text>
            </View>
          ) : null}
        </GroupedList>
      </View>
      {hasAI ? <Banner icon="warning" text="AI interpretation may be inaccurate. Rows marked AI proposed are suggestions until the requester confirms them." /> : null}

      <View>
        <SectionHeader title="Original report" />
        {view.originalReport !== null ? (
          <View testID="original-report" className="rounded-card bg-card p-4">
            <Text className="text-[15px] leading-[22px] text-ink">“{view.originalReport}”</Text>
            <Text className="mt-2 text-[12px] text-gray-1">The requester’s own words. Never edited.</Text>
          </View>
        ) : (
          <View className="flex-row items-center gap-2 rounded-card bg-card p-4">
            <Icon name={view.state.reports.length === 0 && view.role === 'reporter' ? 'description' : 'lock'} size={18} color={colors.gray1} />
            <Text className="flex-1 text-[14px] text-gray-1">
              {view.role === 'reporter' ? 'No report was added. The request was sent as a manual SOS.' : 'No report is readable on this device.'}
            </Text>
          </View>
        )}
      </View>

      {mayObserve ? (
        <GroupedList>
          <ListRow testID="add-observation" first icon="add_comment" title="Add observation" subtitle="Recorded as your statement. It never overwrites someone else’s." onPress={() => setObserving(true)} />
        </GroupedList>
      ) : null}

      <Sheet visible={observing} onClose={() => setObserving(false)} title="Add observation">
        <Text className="text-[14px] leading-[20px] text-gray-1">Say what you see or know, in your own words. If it disagrees with another statement, both are kept.</Text>
        <TextField testID="observation-input" label="Observation" placeholder="For example: I am at the stairs on the fourth floor." value={text} onChangeText={setText} multiline autoFocus />
        <Button
          testID="observation-submit"
          label="Add observation"
          disabled={busy !== null || text.trim().length === 0}
          onPress={async () => {
            const r = await run('observe', () => actions.addObservation(view.id, text.trim()));
            if (r.ok) {
              setText('');
              setObserving(false);
            }
          }}
        />
      </Sheet>
    </View>
  );
}
