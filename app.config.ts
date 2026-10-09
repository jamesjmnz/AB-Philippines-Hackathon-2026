import type { ConfigContext, ExpoConfig } from 'expo/config';

// All native configuration lives here (CNG). The generated ios/ folder is not committed.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'SAGIP',
  slug: 'pulse',
  version: '0.1.0',
  scheme: 'pulse',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/images/icon.png',
  ios: {
    bundleIdentifier: 'com.jamesjmnz.pulse',
    supportsTablet: false,
    appleTeamId: process.env.EXPO_APPLE_TEAM_ID,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSMicrophoneUsageDescription:
        'PULSE records a voice report only after you start a recording, and transcribes it on this iPhone.',
      NSSpeechRecognitionUsageDescription:
        'PULSE turns your recorded voice report into text on this iPhone. Audio is not uploaded.',
      NSLocalNetworkUsageDescription:
        'PULSE finds trusted nearby iPhones and exchanges encrypted assistance requests with them without internet.',
      NSBonjourServices: ['_pulse-sos._tcp'],
    },
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
    'expo-font',
    ['expo-splash-screen', { backgroundColor: '#FFFFFF', image: './assets/images/splash-icon.png', imageWidth: 76 }],
    ['expo-build-properties', { ios: { deploymentTarget: '17.0' } }],
  ],
  experiments: { typedRoutes: true },
});
