# iOS build and device setup

Status (2026-10-10): **BUILT, not installed on any phone.** EAS development build `fbc85457` finished and EAS simulator build `66901962` runs in the iOS 26.3 simulator. Installing `fbc85457` on the iPhone 17 Pro Max failed because the phone was locked, so nothing is VERIFIED ON DEVICE. Local Xcode device builds fail on this Mac (no iOS 26.2 platform component). Every real attempt is in the build log below.

## Ground rules

- **Development builds only. Expo Go is not supported**, because the app uses native modules that Expo Go does not contain (`@react-native-ai/apple`, `modules/pulse-peer`, `modules/pulse-crypto`).
- iOS only. Verification is on physical iPhones. One simulator runtime (iOS 26.3) is installed and is used to look at screens in Demo mode; a simulator run is not device verification.
- The `ios/` folder is generated (Continuous Native Generation) and is git-ignored. Do not hand-edit it. Native configuration lives in `app.config.ts` and config plugins.

## Prerequisites on the Mac (audited)

| Tool | Version |
| --- | --- |
| Xcode | 26.3 (iOS 26.2 SDK; the iOS 26.2 platform component is not installed, so local device builds fail) |
| Simulator runtimes | iOS 26.3 |
| Node / npm | 22.23 / 10.9 |
| CocoaPods | 1.16.2 |
| Signing | One valid "Apple Development" identity |
| eas-cli | 20.5.1. Audited as not logged in on 2026-10-09. EAS builds ran on 2026-10-10, so a login existed then; the current login state was not re-checked. |

## Project configuration

| Setting | Value |
| --- | --- |
| Bundle identifier | `com.jamesjmnz.sagip` |
| Deployment target | iOS 17.0 |
| New Architecture | enabled |
| URL scheme | `pulse` |
| Team ID | Read from the `EXPO_APPLE_TEAM_ID` environment variable |

`.env.example` documents `EXPO_APPLE_TEAM_ID` with a fake placeholder. Put the real value in an untracked `.env.local`. Never commit it.

Permission strings declared in `app.config.ts`: microphone, speech recognition, local network, and the Bonjour service `_sagip-sos._tcp`.

## Prepare each iPhone

1. Connect the iPhone to the Mac by cable and unlock it. Tap **Trust** when asked.
2. Enable Developer Mode: Settings > Privacy & Security > Developer Mode, turn on, restart, confirm.
3. iPhone 17 Pro Max only, for the text model: Settings > Apple Intelligence & Siri, turn Apple Intelligence on, and wait until the model download completes. Do this while online, before any offline test.
4. After the first install, if iOS refuses to open the app: Settings > General > VPN & Device Management, select the developer certificate, tap **Trust**.

Device state today: iPhone 17 Pro Max (iOS 26.6) is paired with the Mac. iPhone 14 Pro Max and iPhone 13 are not yet paired; the owner plans to update them to iOS 26 first.

## Build and install locally

On this Mac this path currently fails at `expo run:ios --device` (see the build log). It works only after `xcodebuild -downloadPlatform iOS` (several GB), which is left for the owner. Until then, device builds come from EAS.

```bash
npm install
npx expo prebuild --platform ios
npx expo run:ios --device
```

Equivalent scripts in `package.json`: `npm run prebuild` (adds `--clean`) and `npm run ios`.

`expo run:ios --device` lists connected devices; choose the target iPhone. Then start the bundler for later sessions:

```bash
npm start
```

The iPhone and the Mac must be able to reach each other for the development bundler. Offline tests need a build that does not depend on the bundler: the `preview` profile (see EAS Build below). It has never been built.

## EAS

Profiles are in `eas.json`; see "EAS Build" below.

- Local Xcode builds do not need an Expo account.
- `eas login` is a human step that needs the owner's credentials. Agents do not run it.
- No production submission or App Store release is in scope.

## Known risk

Resolved for the build: `@react-native-ai/apple` 0.12.0 compiles against React Native 0.86.3 (build `fbc85457`). The SDK 54 fallback was not triggered. **UNVERIFIED:** that it runs on a device. See [TECH_STACK.md](TECH_STACK.md).

## Build log

Record each real attempt here. Results are copied from the evidence log in [AGENTIC_PROGRESS.md](AGENTIC_PROGRESS.md).

| Date | Command | Device | Result | Notes |
| --- | --- | --- | --- | --- |
| 2026-10-09 | `npx expo prebuild --platform ios --clean` | n/a | Completed | `Podfile.lock` contains `AppleLLM (0.12.0)`. App target deployment target 17.0. |
| 2026-10-09 | `npx expo run:ios --device` | iPhone 17 Pro Max | FAILED before compiling | `xcodebuild` exit 70: "iOS 26.2 is not installed. Please download and install the platform from Xcode > Settings > Components." Signing team resolved automatically. |
| 2026-10-10 (date the note was written; the attempt itself is not dated) | `eas build -p ios --profile development`, non-interactive | n/a | FAILED before building | "couldn't find any credentials suitable for internal distribution". Credentials have to be created once, interactively, by the owner. |
| 2026-10-10 | `eas build -p ios --profile development` (build `fbc85457`) | Device binary | BUILT | FINISHED. Xcode 26.6, iOS 26.5 SDK. Binary contains `PulsePeerModule`, `PulseCryptoModule`, `AppleLLM` and links `FoundationModels`; bundle id `com.jamesjmnz.sagip`, minimum iOS 17.0. |
| 2026-10-10 | `xcrun devicectl device install app` | iPhone 17 Pro Max | FAILED | Device locked (`kAMDMobileImageMounterDeviceLocked`). Not installed, not launched. |
| 2026-10-10 | `eas build -p ios --profile simulator` (build `66901962`, from `b759539`); `xcrun simctl install`; Metro dev client | iPhone 17 Pro Max simulator, iOS 26.3 | BUILT; launched in the simulator | Bundle loaded without errors. Looked at in Demo mode only. Not a physical device. |

Not built: the `preview` profile. Not attempted: any install on the iPhone 14 Pro Max or iPhone 13.

## Human-only steps outstanding

1. iPhone 17 Pro Max: unlock it and keep it unlocked, then install build `fbc85457` again. Developer Mode must be on.
2. On first launch, trust the developer certificate: Settings > General > VPN & Device Management.
3. iPhone 17 Pro Max: Apple Intelligence on and the model download finished, while online.
4. iPhone 14 Pro Max and iPhone 13: update to iOS 26, pair with the Mac, register with `eas device:create`, then rebuild so the provisioning profile includes them.
5. `eas build -p ios --profile preview` for offline runs (owner's Expo and Apple credentials).
6. Confirm to the lead, naming the phone, that the app launched. Only then is it VERIFIED ON DEVICE.

## Troubleshooting

- Install fails with `kAMDMobileImageMounterDeviceLocked`: the phone is locked. Unlock it and retry.
- `expo run:ios --device` fails with "iOS 26.2 is not installed": the platform component is missing from Xcode; use EAS, or run `xcodebuild -downloadPlatform iOS`.
- Pills and buttons render unstyled although tests pass: a function-form `style` on `Pressable` is dropped by the NativeWind JSX transform. Use a plain style object.

## EAS Build (added 2026-10-10)

EAS project: `@jamesjimenezzz/sagip` (linked in `app.config.ts`). Profiles are in `eas.json`.

| Profile | What it produces | Use |
| --- | --- | --- |
| `development` | Dev client, internal distribution | Day-to-day development. Needs Metro running on the Mac, so it is not an offline build. |
| `preview` | Release build with the JS bundle embedded, internal distribution | Offline tests and the demo: runs in airplane mode with no Mac. |
| `production` | Store build | Not used for the hackathon. |
| `simulator` | Dev client for the iOS simulator | Looking at screens in Demo mode on the Mac. Needs Metro. |

Status: `development` built (`fbc85457`) and `simulator` built (`66901962`). `preview` has never been built. A first
non-interactive attempt stopped at "couldn't find any credentials suitable for internal distribution". A build finished
afterwards, so credentials exist now; how they were created is not recorded here.

One-time interactive steps (they ask for the Apple ID and need a paid Apple Developer Program membership,
because internal distribution uses ad hoc provisioning):

```bash
eas device:create                               # register each additional iPhone (the 17 Pro Max is already registered) (open the link on the phone)
eas build -p ios --profile development          # creates the certificate and provisioning profile, then builds
eas build -p ios --profile preview              # offline-capable build for the demo
```

After the first interactive build, later builds can run with `--non-interactive`.

Answered by build `fbc85457`: the EAS image used Xcode 26.6 with the iOS 26.5 SDK, and `@react-native-ai/apple` and
both local Swift modules compiled there. UNVERIFIED: the `preview` profile, which has not been built.
