import '../testing/mocks';

import { fireEvent, render, screen } from '@testing-library/react-native';

import { PulseTabBar } from '../PulseTabBar';

describe('tab bar', () => {
  it('renders Home, Network, SOS, Activity and Settings with an accessible SOS button', () => {
    const onSelect = jest.fn();
    const onSOS = jest.fn();
    render(<PulseTabBar active="index" onSelect={onSelect} onSOS={onSOS} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual(['Home', 'Network', 'Activity', 'Settings']);
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByRole('tab', { name: 'Network' })).toHaveProp('accessibilityState', { selected: false });

    const sos = screen.getByRole('button', { name: 'Request assistance' });
    expect(sos).toBeTruthy();
    expect(screen.getByText('SOS')).toBeTruthy();

    fireEvent.press(sos);
    expect(onSOS).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('tab', { name: 'Activity' }));
    expect(onSelect).toHaveBeenCalledWith('activity');
  });
});
