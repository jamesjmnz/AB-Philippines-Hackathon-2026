import type { ConfigContext, ExpoConfig } from 'expo/config';

// All native configuration lives here (CNG). The generated ios/ folder is not committed.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'SAGIP',
  slug: 'sagip',
  version: '0.1.0',
  scheme: 'sagip',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/images/icon.png',
  ios: {
    bundleIdentifier: 'com.jamesjmnz.sagip',
    supportsTablet: false,
    appleTeamId: process.env.EXPO_APPLE_TEAM_ID,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSMicrophoneUsageDescription:
        'SAGIP records a voice report only after you start a recording, and transcribes it on this iPhone.',
      NSSpeechRecognitionUsageDescription:
        'SAGIP turns your recorded voice report into text on this iPhone. Audio is not uploaded.',
      NSLocalNetworkUsageDescription:
        'SAGIP finds trusted nearby iPhones and exchanges encrypted assistance requests with them without internet.',
      NSBonjourServices: ['_sagip-sos._tcp'],
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
  owner: 'jamesjimenezzz',
  extra: { eas: { projectId: 'd30674b9-4ec8-4840-b8c9-1a28c10b62d4' } },
});
