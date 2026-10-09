import { useState } from 'react';
import { Text, View } from 'react-native';

import type { AIFailureState, TaskKind, TaskProposal } from '@/ai';
import {
  canAcceptTask,
  canAcknowledge,
  canCancelIncident,
  canConfirmCompletion,
  canDeclineRequest,
  canDeclineTask,
  canOfferTask,
  canReportCompletion,
  canReportProgress,
  canResolveIncident,
  type Actor,
  type AssistanceTask,
} from '@/domain';
import type { IncidentView } from '@/services/api';
import { usePulseActions } from '@/services/PulseProvider';
import { Avatar, Banner, Button, Chip, ChoiceChip, Dialog, GroupedList, Icon, MicroPill, SectionHeader, Sheet, TextButton, TextField, colors } from '@/ui';

import { displayName, firstName, presentAIState, presentDelivery, TASK_STATUS } from '../present';
import { useRun } from './useRun';

const KIND_LABEL: Record<TaskKind, string> = {
  communicate: 'Stay in contact',
  go_to_requester: 'Go to the requester',
  confirm_location: 'Confirm the location',
  other: 'Other',
};

type TaskAction = { key: string; label: string; primary?: boolean; run: () => void };

function TaskRow({ view, actor, task, first }: { view: IncidentView; actor: Actor; task: AssistanceTask; first: boolean }) {
  const actions = usePulseActions();
  const { busy, run } = useRun();
  const mine = task.assignee?.deviceId === actor.deviceId;
  const forSomeoneElse = task.offeredToDeviceId !== null && task.offeredToDeviceId !== actor.deviceId;
  const status = TASK_STATUS[task.status];
  const who = task.assignee
    ? `${displayName(actor, task.assignee.deviceId, firstName(task.assignee.userName))}${task.status === 'in_progress' && task.inPerson ? ' · arrival not confirmed' : ''}`
    : forSomeoneElse
      ? `Offered to ${firstName(view.state.recipients.find((r) => r.deviceId === task.offeredToDeviceId)?.userName ?? 'another device')}`
      : 'Nobody has taken this yet';

  const list: TaskAction[] = [];
  const open = task.status === 'unassigned' || task.status === 'offered';
  if (view.role === 'responder' && open && !forSomeoneElse) {
    if (canAcceptTask(view.state, actor, task.id).ok) {
      list.push({ key: 'accept', label: 'Take this role', primary: true, run: () => void run('accept', () => actions.acceptTask(view.id, task.id)) });
    }
    if (canDeclineTask(view.state, actor, task.id).ok && !task.declinedByDeviceIds.includes(actor.deviceId)) {
      list.push({ key: 'decline', label: 'Decline', run: () => void run('decline', () => actions.declineTask(view.id, task.id)) });
    }
  }
  if (mine && task.status === 'accepted' && canReportProgress(view.state, actor, task.id).ok) {
    list.push({ key: 'start', label: task.inPerson ? 'I’m on my way' : 'Start', primary: true, run: () => void run('start', () => actions.startTask(view.id, task.id)) });
  }
  if (mine && canReportCompletion(view.state, actor, task.id).ok) {
    list.push({ key: 'done', label: 'Report done', primary: task.status === 'in_progress', run: () => void run('done', () => actions.reportTaskComplete(view.id, task.id)) });
  }
  if (mine && (task.status === 'accepted' || task.status === 'in_progress') && canDeclineTask(view.state, actor, task.id).ok) {
    list.push({ key: 'release', label: 'Release', run: () => void run('release', () => actions.declineTask(view.id, task.id)) });
  }
  if (canConfirmCompletion(view.state, actor, task.id).ok) {
    list.push({ key: 'confirm', label: 'Confirm done', primary: true, run: () => void run('confirm', () => actions.confirmTaskComplete(view.id, task.id)) });
  }

  return (
    <View testID={`task-${task.id}`} className={`px-4 py-[14px] ${first ? '' : 'border-t border-hairline'}`}>
      <View className="flex-row items-center gap-3">
        {task.assignee ? (
          <Avatar name={task.assignee.userName} size={32} self={mine} />
        ) : (
          <View className="h-8 w-8 items-center justify-center rounded-full bg-hairline">
            <Icon name="person" size={16} color={colors.gray1} />
          </View>
        )}
        <View className="flex-1">
          <Text className="text-[15px] font-semibold leading-[20px] text-ink">{task.title}</Text>
          <Text className="mt-0.5 text-[12.5px] text-gray-1">{who}</Text>
          {task.origin === 'ai_suggested' ? <Text className="mt-0.5 text-[12px] text-indigo">Suggested by AI · added by a person</Text> : null}
        </View>
        <Chip label={status.label} tone={status.tone} solid={status.solid} />
      </View>
      {task.status === 'completion_reported' && !canConfirmCompletion(view.state, actor, task.id).ok ? (
        <Text className="mt-2 pl-11 text-[12.5px] text-gray-1">Reported done. Waiting for the requester to confirm.</Text>
      ) : null}
      {list.length > 0 ? (
        <View className="mt-3 flex-row flex-wrap gap-2 pl-11">
          {list.map((a) => (
            <View key={a.key} className="min-w-[120px] flex-1">
              <Button testID={`task-${a.key}-${task.id}`} label={a.label} size="sm" variant={a.primary ? 'primary' : 'secondary'} disabled={busy !== null} onPress={a.run} />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

type Suggestions = { state: 'idle' } | { state: 'loading' } | { state: 'ok'; items: TaskProposal[]; source: string } | { state: 'failed'; reason: AIFailureState };

export function CoordinationTab({ view, actor }: { view: IncidentView; actor: Actor }) {
  const actions = usePulseActions();
  const { busy, run } = useRun();
  const [dialog, setDialog] = useState<'resolve' | 'cancel' | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<TaskKind>('communicate');
  const [suggestions, setSuggestions] = useState<Suggestions>({ state: 'idle' });
  const [added, setAdded] = useState<string[]>([]);

  const myRecipient = view.state.recipients.find((r) => r.deviceId === actor.deviceId);
  const mayAck = canAcknowledge(view.state, actor).ok && myRecipient !== undefined && !myRecipient.acknowledged;
  const mayDecline = canDeclineRequest(view.state, actor).ok && myRecipient !== undefined && !myRecipient.declined;
  const mayOffer = canOfferTask(view.state, actor, '', null).ok;
  const mayResolve = canResolveIncident(view.state, actor).ok;
  const mayCancel = canCancelIncident(view.state, actor).ok;

  const suggest = async () => {
    setSuggestions({ state: 'loading' });
    const r = await actions.suggestTasks(view.id);
    setSuggestions(r.ok ? { state: 'ok', items: r.value, source: r.meta.source } : { state: 'failed', reason: r.state });
  };

  return (
    <View className="gap-[14px]">
      {myRecipient ? (
        <View testID="responder-actions" className="gap-3 rounded-card bg-card p-4">
          <Text className="text-[13.5px] leading-[19px] text-gray-2">
            {myRecipient.declined
              ? 'You said you can’t help with this request.'
              : myRecipient.acknowledged
                ? 'You marked this as seen. That does not commit you to anything; take a role below if you can help.'
                : 'Marking as seen tells the requester you have read this. It is not the same as taking a role.'}
          </Text>
          {mayAck || mayDecline ? (
            <View className="flex-row gap-[10px]">
              {mayAck ? (
                <View className="flex-1">
                  <Button testID="ack" label="Mark as seen" size="sm" variant="secondary" disabled={busy !== null} onPress={() => void run('ack', () => actions.acknowledge(view.id))} />
                </View>
              ) : null}
              {mayDecline ? (
                <View className="flex-1">
                  <Button testID="cant-help" label="Can’t help" size="sm" variant="secondary" disabled={busy !== null} onPress={() => void run('decline', () => actions.declineRequest(view.id))} />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      <View>
        <SectionHeader title="Who’s helping" />
        <GroupedList>
          {view.state.tasks.length === 0 ? (
            <View testID="tasks-empty" className="px-4 py-4">
              <Text className="text-[14px] text-gray-1">No roles yet. Nobody has been asked to do anything specific.</Text>
            </View>
          ) : (
            view.state.tasks.map((t, i) => <TaskRow key={t.id} view={view} actor={actor} task={t} first={i === 0} />)
          )}
          {mayOffer ? (
            <View className="border-t border-hairline">
              <TextButton testID="request-more" label={view.role === 'reporter' ? '+ Request more help' : '+ Offer a role'} tone="ink" onPress={() => setAdding(true)} />
            </View>
          ) : null}
        </GroupedList>
      </View>

      {mayOffer ? (
        <View testID="ai-tasks" className="gap-3 rounded-feature border border-indigo-line bg-card p-[18px]">
          <View className="flex-row items-center gap-1.5">
            <Icon name="auto_awesome" size={16} color={colors.indigo} />
            <Text className="flex-1 text-[12px] font-bold text-indigo">Suggested by AI · non-medical roles</Text>
            {suggestions.state === 'ok' && suggestions.source === 'simulated' ? <MicroPill label="Simulated" /> : null}
          </View>
          {suggestions.state === 'idle' ? (
            <>
              <Text className="text-[13.5px] leading-[19px] text-gray-2">Ask the on-device model for roles people could take. Nothing is added unless you add it.</Text>
              <Button testID="ai-tasks-run" label="Suggest roles on this device" size="sm" variant="secondary" icon="auto_awesome" onPress={() => void suggest()} />
            </>
          ) : null}
          {suggestions.state === 'loading' ? <Text accessibilityLiveRegion="polite" className="text-[13.5px] text-gray-1">Asking the on-device model…</Text> : null}
          {suggestions.state === 'failed' ? (
            <Text testID="ai-tasks-failed" accessibilityLiveRegion="polite" className="text-[13.5px] leading-[19px] text-gray-2">
              Local AI unavailable ({presentAIState(suggestions.reason).label.toLowerCase()}). You can still add roles yourself.
            </Text>
          ) : null}
          {suggestions.state === 'ok' && suggestions.items.length === 0 ? <Text className="text-[13.5px] text-gray-1">No suggestions.</Text> : null}
          {suggestions.state === 'ok'
            ? suggestions.items.map((s) => {
                const key = `${s.kind}:${s.title}`;
                const done = added.includes(key);
                return (
                  <View key={key} className="flex-row items-center gap-3 rounded-2xl bg-page p-3">
                    <View className="flex-1">
                      <Text className="text-[14.5px] font-semibold text-ink">{s.title}</Text>
                      <Text className="mt-0.5 text-[12px] text-gray-1">{KIND_LABEL[s.kind]}</Text>
                    </View>
                    {done ? (
                      <Chip label="Added" tone="gray" />
                    ) : (
                      <Button
                        testID={`ai-task-add-${s.kind}`}
                        label="Add"
                        size="sm"
                        disabled={busy !== null}
                        onPress={async () => {
                          const r = await run('offer', () => actions.offerTask(view.id, { kind: s.kind, title: s.title, aiSuggested: true }));
                          if (r.ok) setAdded((a) => [...a, key]);
                        }}
                      />
                    )}
                  </View>
                );
              })
            : null}
        </View>
      ) : null}

      <View>
        <SectionHeader title="Recipients" />
        <GroupedList>
          {view.state.recipients.length === 0 ? (
            <View testID="recipients-empty" className="px-4 py-4">
              <Text className="text-[14px] text-gray-1">No trusted device paired when this was created. Nobody has received it.</Text>
            </View>
          ) : (
            view.state.recipients.map((r, i) => {
              const d = presentDelivery(r.delivery);
              return (
                <View key={r.deviceId} testID={`recipient-${r.deviceId}`} className={`flex-row items-center gap-3 px-4 py-3 ${i === 0 ? '' : 'border-t border-hairline'}`}>
                  <Avatar name={r.userName} size={34} self={r.deviceId === actor.deviceId} />
                  <View className="flex-1">
                    <Text className="text-[15px] font-semibold text-ink">{displayName(actor, r.deviceId, r.userName)}</Text>
                    <Text className="text-[12px] text-gray-1">{r.declined ? 'Can’t help' : r.acknowledged ? 'Seen' : 'Not seen yet'}</Text>
                  </View>
                  <Chip label={d.label} tone={d.tone} />
                </View>
              );
            })
          )}
        </GroupedList>
        {view.pendingOutbox > 0 ? (
          <View className="mt-2">
            <Button testID="retry-delivery" label="Try delivery again" size="sm" variant="secondary" icon="replay" onPress={() => void actions.retryDelivery(view.id)} />
          </View>
        ) : null}
      </View>

      {view.state.closure ? <Banner tone="gray" text={view.state.closure.kind === 'resolved' ? 'This request is resolved. No further actions are available.' : 'This request was cancelled. No further actions are available.'} /> : null}

      {mayResolve ? <Button testID="resolve" label="Confirm resolution" size="md" onPress={() => setDialog('resolve')} /> : null}
      {mayCancel ? <TextButton testID="cancel-request" label="Cancel request" tone="coral" onPress={() => setDialog('cancel')} /> : null}

      <Dialog
        visible={dialog === 'resolve'}
        title="Confirm resolution?"
        message="This records that the request is resolved, on your word. It closes the request for everyone who receives the update."
        cancelLabel="Not yet"
        confirmLabel="Resolve"
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          setDialog(null);
          void run('resolve', () => actions.resolveIncident(view.id));
        }}
      />
      <Dialog
        visible={dialog === 'cancel'}
        title="Cancel this request?"
        message="The request is closed on this device. Devices that already received it are told only when the update reaches them."
        cancelLabel="Keep"
        confirmLabel="Cancel request"
        destructive
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          setDialog(null);
          void run('cancel', () => actions.cancelIncident(view.id));
        }}
      />

      <Sheet visible={adding} onClose={() => setAdding(false)} title={view.role === 'reporter' ? 'Request more help' : 'Offer a role'}>
        <Text className="text-[14px] leading-[20px] text-gray-1">Describe a non-medical role someone could take. People choose for themselves; nobody is assigned.</Text>
        <View className="flex-row flex-wrap gap-2">
          {(Object.keys(KIND_LABEL) as TaskKind[]).map((k) => (
            <ChoiceChip key={k} label={KIND_LABEL[k]} selected={kind === k} onPress={() => setKind(k)} />
          ))}
        </View>
        <TextField testID="task-title" label="Role" placeholder="For example: Meet me at the lobby" value={title} onChangeText={setTitle} maxLength={80} />
        <Button
          testID="task-add"
          label="Add role"
          disabled={busy !== null || title.trim().length === 0}
          onPress={async () => {
            const r = await run('offer', () => actions.offerTask(view.id, { kind, title: title.trim() }));
            if (r.ok) {
              setTitle('');
              setAdding(false);
            }
          }}
        />
      </Sheet>
    </View>
  );
}
