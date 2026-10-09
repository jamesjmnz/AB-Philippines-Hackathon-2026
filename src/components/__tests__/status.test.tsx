import '../testing/mocks';

import { render, screen } from '@testing-library/react-native';

import type { IncidentState } from '@/domain';

import { StatusCard } from '../incident/StatusCard';
import { presentSteps } from '../present';
import { ME, viewOf } from '../testing/fakePulseApp';
import {
  MIKA,
  sosAcknowledged,
  sosCancelled,
  sosDelivered,
  sosInProgress,
  sosNoPeer,
  sosQueued,
  sosResolved,
  sosRoleTaken,
  sosSendAttempted,
} from '../testing/scenarios';

type Case = {
  name: string;
  build: () => { state: IncidentState };
  status: IncidentState['status']['status'];
  title: string;
  chip: string;
  sub: RegExp;
  /** Saved / Delivered / Seen / Role taken / Resolved */
  steps: [boolean, boolean, boolean, boolean, boolean];
};

const CASES: Case[] = [
  { name: 'queued with no trusted peer', build: sosNoPeer, status: 'queued', title: 'Saved on this device', chip: 'Not delivered', sub: /No trusted device paired/, steps: [true, false, false, false, false] },
  { name: 'queued awaiting a peer', build: sosQueued, status: 'queued', title: 'Saved on this device', chip: 'Queued', sub: /Saved on this device · waiting for a trusted device/, steps: [true, false, false, false, false] },
  { name: 'send attempted without a receipt', build: sosSendAttempted, status: 'queued', title: 'Sending…', chip: 'Not delivered yet', sub: /No delivery receipt/, steps: [true, false, false, false, false] },
  { name: 'delivered', build: sosDelivered, status: 'delivered', title: 'Delivered · not yet seen', chip: 'Delivered', sub: /confirmed receipt/, steps: [true, true, false, false, false] },
  { name: 'acknowledged', build: sosAcknowledged, status: 'acknowledged', title: 'Seen by Mika', chip: 'Seen', sub: /Seen is not the same as accepting/, steps: [true, true, true, false, false] },
  { name: 'role_taken', build: sosRoleTaken, status: 'role_taken', title: 'Mika took a role', chip: 'Role taken', sub: /Nobody has reported being on the way/, steps: [true, true, true, true, false] },
  { name: 'in_progress', build: sosInProgress, status: 'in_progress', title: 'Mika is on the way', chip: 'In progress', sub: /Arrival is not confirmed/, steps: [true, true, true, true, false] },
  { name: 'resolved', build: sosResolved, status: 'resolved', title: 'Resolved', chip: 'Resolved', sub: /Marked resolved by You/, steps: [true, true, true, true, true] },
  { name: 'cancelled', build: sosCancelled, status: 'cancelled', title: 'Cancelled', chip: 'Cancelled', sub: /Cancelled by You/, steps: [true, false, false, false, false] },
];

describe('status card', () => {
  it.each(CASES)('$name', ({ build, status, title, chip, sub, steps }) => {
    const { state } = build();
    expect(state.status.status).toBe(status);
    render(<StatusCard view={viewOf(state)} me={ME} />);

    expect(screen.getByTestId('status-title')).toHaveTextContent(title);
    expect(screen.getByTestId('status-chip')).toHaveTextContent(chip);
    expect(screen.getByTestId('status-sub')).toHaveTextContent(sub);

    const labels = ['Saved', 'Delivered', 'Seen', 'Role taken', 'Resolved'];
    const expected = labels.map((label, i) => `${label} ${steps[i] ? 'done' : 'pending'}`).join(', ');
    expect(screen.getByRole('progressbar')).toHaveProp('accessibilityLabel', expected);
    expect(presentSteps(state).map((s) => s.done)).toEqual(steps);
  });

  it('never words a queued or attempted send as sent, delivered or on the way', () => {
    for (const build of [sosNoPeer, sosQueued, sosSendAttempted]) {
      const view = render(<StatusCard view={viewOf(build().state)} me={ME} />);
      expect(screen.queryByText(/\bSent\b/)).toBeNull();
      expect(screen.queryByText(/on the way/i)).toBeNull();
      expect(screen.queryByText(/notified|alerted/i)).toBeNull();
      expect(screen.getByTestId('status-chip')).not.toHaveTextContent('Delivered');
      view.unmount();
    }
  });

  it('says "on the way" only while an in-person task is in progress', () => {
    for (const build of [sosDelivered, sosAcknowledged, sosRoleTaken]) {
      const view = render(<StatusCard view={viewOf(build().state)} me={ME} />);
      expect(screen.getByTestId('status-title')).not.toHaveTextContent(/on the way/i);
      view.unmount();
    }
  });

  it('tells a responder the request is on their device without claiming the requester knows', () => {
    render(<StatusCard view={viewOf(sosQueued().state, MIKA)} me={MIKA} />);
    expect(screen.getByTestId('status-title')).toHaveTextContent('Received on this device');
    expect(screen.getByTestId('status-chip')).toHaveTextContent('Received');
    expect(screen.getByTestId('status-chip')).not.toHaveTextContent('Delivered');
    expect(screen.getByRole('progressbar')).toHaveProp('accessibilityLabel', 'Saved done, Delivered pending, Seen pending, Role taken pending, Resolved pending');
  });

  it('shows the reported location words instead of a map, or says they are unknown', () => {
    render(<StatusCard view={viewOf(sosQueued().state)} me={ME} />);
    expect(screen.getByTestId('status-place')).toHaveTextContent('Location not reported');
  });
});
