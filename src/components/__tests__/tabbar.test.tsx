import '../testing/mocks';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { tabBarHeight } from '@/ui';

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

  it('keeps the design geometry: five columns, 62pt raised coral SOS with a 4pt white border', () => {
    render(<PulseTabBar active="network" onSelect={jest.fn()} onSOS={jest.fn()} />);

    const bar = StyleSheet.flatten(screen.getByTestId('tab-bar').props.style);
    // 60pt of content above the bottom inset (94px in the design frame, whose inset is 34). White at 94%
    // over the backdrop blur, as in the design; the blur layer is the bar's first child.
    expect(bar).toMatchObject({ position: 'absolute', bottom: 0, height: 70, paddingTop: 8, paddingHorizontal: 6, backgroundColor: 'rgba(255,255,255,0.94)', borderTopWidth: 1, borderTopColor: '#EEEEF0' });
    expect(tabBarHeight(34)).toBe(94);
    expect(screen.getByTestId('tab-bar').props.children).toHaveLength(4);
    for (const key of ['index', 'network', 'activity', 'settings']) {
      expect(StyleSheet.flatten(screen.getByTestId(`tab-${key}`).props.style)).toMatchObject({ flex: 1 });
    }

    const sos = StyleSheet.flatten(screen.getByTestId('tab-sos').props.style);
    expect(sos).toMatchObject({ width: 62, height: 62, borderRadius: 31, marginTop: -22, backgroundColor: '#ED625E', borderWidth: 4, borderColor: '#FFFFFF', shadowColor: '#ED625E', shadowOpacity: 0.22, shadowRadius: 12 });
    expect(StyleSheet.flatten(screen.getByText('SOS').props.style)).toMatchObject({ fontSize: 15, fontWeight: '800', letterSpacing: 0.5 });
    expect(StyleSheet.flatten(screen.getByText('Network').props.style)).toMatchObject({ fontSize: 10.5, fontWeight: '600', color: '#151515' });
    expect(StyleSheet.flatten(screen.getByText('Home').props.style)).toMatchObject({ color: '#A1A1A6' });
  });
});
