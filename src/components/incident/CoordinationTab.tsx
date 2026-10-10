import { useState } from 'react';
import { Pressable, View } from 'react-native';

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
import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Avatar, ChoiceChip, Dialog, Icon, LinkButton, Pill, Sheet, colors, useToast } from '@/ui';

import { BRAND, displayName, firstName, presentAIState, TASK_LOOK, TASK_STATUS } from '../present';
import { CardBox, INK_LINES, SectionTitle, TagPill } from './parts';
import { useRun } from './useRun';
import { Text, TextInput } from '@/ui/Text';

const KIND_LABEL: Record<TaskKind, string> = {
  communicate: 'Stay in contact',
  go_to_requester: 'Go to the requester',
  confirm_location: 'Confirm the location',
  other: 'Other',
};

type TaskAction = { key: string; label: string; primary?: boolean; run: () => void };

/** One role (design 500–507): padding 14/16, 32pt avatar, 15/600 title, 12.5 who-line, pill, 38pt actions. */
function TaskRow({ view, actor, task, first }: { view: IncidentView; actor: Actor; task: AssistanceTask; first: boolean }) {
  const actions = usePulseActions();
  const { busy, run } = useRun();
  const mine = task.assignee?.deviceId === actor.deviceId;
  const forSomeoneElse = task.offeredToDeviceId !== null && task.offeredToDeviceId !== actor.deviceId;
  const status = TASK_STATUS[task.status];
  const look = TASK_LOOK[task.status];
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
      list.push({ key: 'decline', label: 'Can’t help', run: () => void run('decline', () => actions.declineTask(view.id, task.id)) });
    }
  }
  if (mine && task.status === 'accepted' && canReportProgress(view.state, actor, task.id).ok) {
    list.push({ key: 'start', label: task.inPerson ? 'I’m on my way' : 'Start', run: () => void run('start', () => actions.startTask(view.id, task.id)) });
  }
  if (mine && canReportCompletion(view.state, actor, task.id).ok) {
    list.push({ key: 'done', label: 'I’m done', primary: true, run: () => void run('done', () => actions.reportTaskComplete(view.id, task.id)) });
  }
  if (mine && (task.status === 'accepted' || task.status === 'in_progress') && canDeclineTask(view.state, actor, task.id).ok) {
    list.push({ key: 'release', label: 'Release', run: () => void run('release', () => actions.declineTask(view.id, task.id)) });
  }
  if (canConfirmCompletion(view.state, actor, task.id).ok) {
    list.push({ key: 'confirm', label: 'Confirm', primary: true, run: () => void run('confirm', () => actions.confirmTaskComplete(view.id, task.id)) });
  }

  return (
    <View testID={`task-${task.id}`} style={{ paddingVertical: 14, paddingHorizontal: 16, borderTopWidth: first ? 0 : 1, borderTopColor: colors.hairline }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {task.assignee ? (
          <Avatar name={task.assignee.userName} size={32} self={mine} />
        ) : (
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.line, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.gray1 }}>?</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', lineHeight: 20, color: colors.ink }}>{task.title}</Text>
          <Text style={{ fontSize: 13, color: colors.gray1, marginTop: 2 }}>{who}</Text>
          {task.origin === 'ai_suggested' ? <Text style={{ fontSize: 12, color: colors.indigo, marginTop: 2 }}>Suggested by AI · added by a person</Text> : null}
        </View>
        <TagPill label={status.label} fg={look.fg} bg={look.bg} />
      </View>
      {task.status === 'completion_reported' && !canConfirmCompletion(view.state, actor, task.id).ok ? (
        <Text style={{ fontSize: 13, color: colors.gray1, marginTop: 8, paddingLeft: 44 }}>Reported done. Waiting for the requester to confirm.</Text>
      ) : null}
      {list.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, paddingLeft: 44 }}>
          {list.map((a) => (
            <Pill key={a.key} testID={`task-${a.key}-${task.id}`} flex label={a.label} tone={a.primary ? 'ink' : 'soft'} h={38} size={13.5} press={0.97} disabled={busy !== null} onPress={a.run} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

type Suggestions = { state: 'idle' } | { state: 'loading' } | { state: 'ok'; items: TaskProposal[]; source: string } | { state: 'failed'; reason: AIFailureState };

/**
 * Coordination segment: "Who’s helping", the resolution and contact actions, and Cancel request, as
 * designed (497–510, 532–535, 557); plus the responder's seen / can't-help card and AI role suggestions.
 */
export function CoordinationTab({ view, actor }: { view: IncidentView; actor: Actor }) {
  const { mode } = usePulse();
  const actions = usePulseActions();
  const { busy, run } = useRun();
  const toast = useToast((s) => s.show);
  const [dialog, setDialog] = useState<'resolve' | 'cancel' | 'decline' | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<TaskKind>('communicate');
  const [suggestions, setSuggestions] = useState<Suggestions>({ state: 'idle' });
  const [added, setAdded] = useState<string[]>([]);

  const state = view.state;
  const myRecipient = state.recipients.find((r) => r.deviceId === actor.deviceId);
  const mayAck = canAcknowledge(state, actor).ok && myRecipient !== undefined && !myRecipient.acknowledged;
  const mayDecline = canDeclineRequest(state, actor).ok && myRecipient !== undefined && !myRecipient.declined;
  const mayOffer = canOfferTask(state, actor, '', null).ok;
  const mayResolve = canResolveIncident(state, actor).ok;
  const mayCancel = canCancelIncident(state, actor).ok;

  const reporter = state.incident?.reporter ?? null;
  const helper = state.tasks.find((t) => t.assignee !== null && t.assignee.deviceId !== reporter?.deviceId)?.assignee ?? null;
  const contactName = view.role === 'reporter' ? (helper ? firstName(helper.userName) : null) : reporter ? firstName(reporter.userName) : null;
  const contactLabel = contactName ? `Contact ${contactName}` : 'Contact trusted responder';

  const suggest = async () => {
    setSuggestions({ state: 'loading' });
    const r = await actions.suggestTasks(view.id);
    setSuggestions(r.ok ? { state: 'ok', items: r.value, source: r.meta.source } : { state: 'failed', reason: r.state });
  };

  return (
    <>
      {myRecipient ? (
        <View testID="responder-actions" style={{ backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, gap: 12 }}>
          <Text style={{ fontSize: 14, lineHeight: 20, color: colors.gray3 }}>
            {myRecipient.declined
              ? 'You said you can’t help with this request.'
              : myRecipient.acknowledged
                ? 'You marked this as seen. That does not commit you to anything; take a role below if you can help.'
                : 'Marking as seen tells the requester you have read this. It is not the same as taking a role.'}
          </Text>
          {mayAck || mayDecline ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {mayAck ? <Pill testID="ack" flex label="Mark as seen" tone="soft" h={46} size={14.5} disabled={busy !== null} onPress={() => void run('ack', () => actions.acknowledge(view.id))} /> : null}
              {mayDecline ? <Pill testID="cant-help" flex label="Can’t help" tone="soft" h={46} size={14.5} disabled={busy !== null} onPress={() => setDialog('decline')} /> : null}
            </View>
          ) : null}
        </View>
      ) : null}

      <SectionTitle>Who’s helping</SectionTitle>
      <CardBox testID="tasks-card">
        {state.tasks.length === 0 ? (
          <View testID="tasks-empty" style={{ paddingVertical: 14, paddingHorizontal: 16 }}>
            <Text style={{ fontSize: 14, lineHeight: 20, color: colors.gray1 }}>No roles yet. Nobody has been asked to do anything specific.</Text>
          </View>
        ) : (
          state.tasks.map((t, i) => <TaskRow key={t.id} view={view} actor={actor} task={t} first={i === 0} />)
        )}
        {mayOffer ? (
          <Pressable
            testID="request-more"
            accessibilityRole="button"
            onPress={() => setAdding(true)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, borderTopWidth: 1, borderTopColor: colors.hairline, backgroundColor: '#FFFFFF' }}>
            <Icon name="add" size={18} />
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>{view.role === 'reporter' ? 'Request more help' : 'Offer a role'}</Text>
          </Pressable>
        ) : null}
      </CardBox>

      {mayOffer ? (
        <View testID="ai-tasks" style={{ backgroundColor: '#FFFFFF', borderRadius: 24, borderWidth: 1, borderColor: INK_LINES.indigoLine, padding: 18, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="auto_awesome" size={16} color={colors.indigo} />
            <Text style={{ flex: 1, fontSize: 12, fontWeight: '700', color: colors.indigo }}>Suggested by AI · non-medical roles</Text>
            {suggestions.state === 'ok' && suggestions.source === 'simulated' ? <TagPill label="SIMULATED" fg={colors.gray1} bg={colors.hairline} /> : null}
          </View>
          {suggestions.state === 'idle' ? (
            <>
              <Text style={{ fontSize: 14, lineHeight: 20, color: colors.gray3 }}>Ask the on-device model for roles people could take. Nothing is added unless you add it.</Text>
              <Pill testID="ai-tasks-run" label="Suggest roles on this device" tone="soft" h={40} size={14} icon="auto_awesome" iconSize={16} onPress={() => void suggest()} />
            </>
          ) : null}
          {suggestions.state === 'loading' ? (
            <Text accessibilityLiveRegion="polite" style={{ fontSize: 14, color: colors.gray1 }}>
              Asking the on-device model…
            </Text>
          ) : null}
          {suggestions.state === 'failed' ? (
            <Text testID="ai-tasks-failed" accessibilityLiveRegion="polite" style={{ fontSize: 14, lineHeight: 20, color: colors.gray3 }}>
              Local AI unavailable ({presentAIState(suggestions.reason).label.toLowerCase()}). You can still add roles yourself.
            </Text>
          ) : null}
          {suggestions.state === 'ok' && suggestions.items.length === 0 ? <Text style={{ fontSize: 14, color: colors.gray1 }}>No suggestions.</Text> : null}
          {suggestions.state === 'ok'
            ? suggestions.items.map((s) => {
                const key = `${s.kind}:${s.title}`;
                const done = added.includes(key);
                return (
                  <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.page, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 12 }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>{s.title}</Text>
                      <Text style={{ fontSize: 12, color: colors.gray1, marginTop: 2 }}>{KIND_LABEL[s.kind]}</Text>
                    </View>
                    {done ? (
                      <TagPill label="Added" fg={colors.gray1} bg={colors.hairline} />
                    ) : (
                      <Pill
                        testID={`ai-task-add-${s.kind}`}
                        label="Add"
                        h={36}
                        size={13.5}
                        px={16}
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

      {state.closure ? (
        <Text testID="closed-note" style={{ fontSize: 13, color: colors.gray1, paddingHorizontal: 4 }}>
          {state.closure.kind === 'resolved' ? 'This request is resolved. No further actions are available.' : 'This request was cancelled. No further actions are available.'}
        </Text>
      ) : (
        <View style={{ gap: 10, marginTop: 4 }}>
          {mayResolve ? <Pill testID="resolve" label="Confirm resolution" h={54} size={16} press={0.98} onPress={() => setDialog('resolve')} /> : null}
          <Pill
            testID="contact"
            label={contactLabel}
            tone="soft"
            h={52}
            size={16}
            icon="call"
            iconSize={19}
            onPress={() => (mode === 'demo' ? toast('Simulated, no call placed', 'call') : toast(`${BRAND} has no number for ${contactName ?? 'them'}. Use your phone to reach them.`, 'call'))}
          />
        </View>
      )}
      {mayCancel ? <LinkButton testID="cancel-request" label="Cancel request" color={colors.coralText} size={15} h={44} onPress={() => setDialog('cancel')} /> : null}

      <Dialog
        visible={dialog === 'resolve'}
        title="Confirm resolution?"
        message="This records that the request is resolved, on your word. It closes the request for everyone who receives the update."
        cancelLabel="Not yet"
        confirmLabel="Resolve"
        confirmColor={colors.greenText}
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
      <Dialog
        visible={dialog === 'decline'}
        title="Can’t help right now?"
        message="The request stays open and your open roles go to someone else."
        cancelLabel="Back"
        confirmLabel="Can’t help"
        destructive
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          setDialog(null);
          void run('decline', () => actions.declineRequest(view.id));
        }}
      />

      <Sheet testID="add-role-sheet" visible={adding} onClose={() => setAdding(false)}>
        <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: '700', letterSpacing: -0.4, color: colors.ink }}>
          {view.role === 'reporter' ? 'Request more help' : 'Offer a role'}
        </Text>
        <Text style={{ fontSize: 14, lineHeight: 21, color: colors.gray1, marginTop: 4 }}>Describe a non-medical role someone could take. People choose for themselves; nobody is assigned.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
          {(Object.keys(KIND_LABEL) as TaskKind[]).map((k) => (
            <ChoiceChip key={k} testID={`task-kind-${k}`} label={KIND_LABEL[k]} selected={kind === k} onPress={() => setKind(k)} />
          ))}
        </View>
        <TextInput
          testID="task-title"
          accessibilityLabel="Role"
          value={title}
          onChangeText={setTitle}
          placeholder="For example: Meet me at the lobby"
          placeholderTextColor={colors.gray4}
          maxLength={80}
          returnKeyType="done"
          style={{ minHeight: 44, borderRadius: 13, borderWidth: 1, borderColor: colors.lineInput, backgroundColor: INK_LINES.fillInput, paddingHorizontal: 14, paddingVertical: 0, fontSize: 16, color: colors.ink, marginTop: 12 }}
        />
        <View style={{ marginTop: 20 }}>
          <Pill
            testID="task-add"
            label="Add role"
            h={54}
            size={16}
            disabled={busy !== null || title.trim().length === 0}
            onPress={async () => {
              const r = await run('offer', () => actions.offerTask(view.id, { kind, title: title.trim() }));
              if (r.ok) {
                setTitle('');
                setAdding(false);
              }
            }}
          />
        </View>
      </Sheet>
    </>
  );
}
