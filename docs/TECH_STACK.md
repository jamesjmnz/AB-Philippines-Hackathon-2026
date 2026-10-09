# Tech stack

Last checked: 2026-10-09. Versions below were selected from the npm registry and from reading package source. `package.json` and `package-lock.json` are the source of truth for what is actually installed. The toolchain table was audited on 2026-10-09, except the simulator row (2026-10-10).

As of 2026-10-10 the selected set compiles together: EAS development build `fbc85457` finished, including `@react-native-ai/apple` 0.12.0 on React Native 0.86.3, and EAS simulator build `66901962` runs in the iOS 26.3 simulator. Nothing has run on a physical iPhone, so "builds together" does not yet mean "proven to work together".

## Toolchain on the development Mac (audited)

| Tool | Version | Note |
| --- | --- | --- |
| Node | 22.23 | |
| npm | 10.9 | Single package manager, single lockfile. |
| Xcode | 26.3 | Ships the iOS 26.2 SDK. |
| Swift | 6.2.4 | |
| CocoaPods | 1.16.2 | |
| eas-cli | 20.5.1 | Installed, not logged in. |
| Simulator runtimes | iOS 26.3 | Used to look at screens in Demo mode. Verification is on physical iPhones. |
| Signing | one valid "Apple Development" identity | |

## Selected version matrix

| Package | Version | Note |
| --- | --- | --- |
| `expo` | 57.0.x | CNG with `expo-dev-client`. New Architecture on. |
| `react-native` | 0.86.3 | |
| `react` | 19.2.3 | |
| `@react-native-ai/apple` | 0.12.0 (npm) | The only npm release in the 0.12 line. Upstream tests it on Expo SDK 54 / RN 0.81 only. |
| `ai` (Vercel AI SDK) | 6.0.302 (`ai-v6` dist-tag) | Not `latest`. |
| `zod` | ^4.2 | Required by the Apple package. |
| `nativewind` | 4.2.7 | |
| `tailwindcss` | 3.4.19 | Not Tailwind 4. |
| `react-native-reanimated` | 4.5.1 | Expo 57 pin, not npm `latest`. |
| `react-native-worklets` | 0.10.1 | Expo 57 pin. |
| `expo-router`, `expo-sqlite`, `expo-audio`, `expo-dev-client`, `jest-expo` | SDK 57 pins | Installed with `npx expo install`. |
| `typescript` | ~6.0.3 | `strict: true`, `noUncheckedIndexedAccess: true`. |

Other planned dependencies: `zustand` (UI state), `react-native-svg` (progress ring, map), `expo-font` (bundled icon font), `@testing-library/react-native` (UI tests), a `@noble` cryptography package as a **test-only** double for the native crypto module.

## Why these pins

### `ai@6`, not 7

`@react-native-ai/apple` 0.12.x targets Vercel AI SDK v6. The npm `latest` tag of `ai` is v7, which is built on a newer provider specification. Installing `ai` without a version would pull v7 and pair it with a provider written for v6. The project pins `ai@6.0.302`.

### Tailwind 3.4, not 4

NativeWind v4 is not compatible with Tailwind CSS 4. NativeWind 4.2.7 is paired with Tailwind 3.4.19.

### npm 0.12.0 of the Apple package, not GitHub `main`

GitHub `main` of `callstackincubator/ai` has typed errors, which would be useful. It does not compile on Xcode 26.3 because it needs the iOS 26.4 SDK; this Mac has the 26.2 SDK. The project uses the published npm 0.12.0 and classifies errors by message text instead (see [LOCAL_AI.md](LOCAL_AI.md)).

### Reanimated and worklets

Expo SDK 57 pins specific versions. Using npm `latest` would break the SDK's version alignment, so `npx expo install` chooses them.

### npm

One package manager and one lockfile, as the master specification requires.

## Known compatibility risk and fallback

**UNVERIFIED:** `@react-native-ai/apple` 0.12.0 building against React Native 0.86 / Expo SDK 57. Upstream tests only SDK 54 / RN 0.81.

Planned check in Phase 1: `npx expo prebuild --platform ios`, then `npx expo run:ios --device` to the iPhone 17 Pro Max with a diagnostics screen that calls `apple.isAvailable()` and one `generateText`.

Fallback rule: if the Apple package fails to build on RN 0.86 after three substantively different attempts (including a `patch-package` patch), the project falls back to **Expo SDK 54 / React Native 0.81.5** and records the change in a new ADR and in [DECISIONS.md](DECISIONS.md). The primary AI provider does not change.

## Native configuration

| Setting | Value | Source |
| --- | --- | --- |
| Bundle identifier | `com.jamesjmnz.sagip` | `app.config.ts` |
| iOS deployment target | 17.0 | `expo-build-properties` in `app.config.ts` |
| New Architecture | enabled | `app.config.ts` |
| Platforms | iOS only | |
| Expo Go | not supported | Native modules require a development build. |

Features that need a newer OS than the deployment target (text model and transcription need iOS 26) are gated at runtime per feature.

The Apple package needs no config plugin, entitlement or Info.plist key of its own. Expo SDK 57 supplies the stream polyfills it relies on.

## Commands

Defined in `package.json`. None has been run to completion as verification yet.

| Script | Command |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `expo lint` |
| `npm test` | `jest` |
| `npm run doctor` | `expo-doctor` |
| `npm run prebuild` | `expo prebuild --platform ios --clean` |
| `npm run ios` | `expo run:ios --device` |
| `npm start` | `expo start --dev-client` |
