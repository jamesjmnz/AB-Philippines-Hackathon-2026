/**
 * Jest module mocks shared by the component tests. Import this file FIRST in a test so the mocks are
 * registered before the screens load. Test-only.
 */
export const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  navigate: jest.fn(),
  dismissTo: jest.fn(),
  canGoBack: jest.fn(() => true),
};

/** The route the app is on, as `usePathname` reports it. Tests set `current`. */
export const mockPathname = { current: '/' };

export const mockOpenURL = jest.fn(async (_url: string) => true);

jest.mock('expo-router', () => ({
  router: mockRouter,
  useRouter: () => mockRouter,
  usePathname: () => mockPathname.current,
  useLocalSearchParams: () => ({}),
  Redirect: () => null,
}));

jest.mock('expo-linking', () => ({ openURL: mockOpenURL, openSettings: jest.fn(async () => undefined) }));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/lib/module/mock'));

jest.mock('react-native-reanimated', () => ({ ...jest.requireActual('react-native-reanimated/mock'), useReducedMotion: () => false }));
