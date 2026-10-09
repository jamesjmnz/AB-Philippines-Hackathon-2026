# iOS build and device setup

Status: instructions only. **No build has been attempted yet** (2026-10-09). These steps will be corrected against real output in Phase 1.

## Ground rules

- **Development builds only. Expo Go is not supported**, because the app uses native modules that Expo Go does not contain (`@react-native-ai/apple`, and later the PULSE Swift modules).
- iOS only. Verification is on physical iPhones; no simulator runtimes are installed on the development Mac.
- The `ios/` folder is generated (Continuous Native Generation) and is git-ignored. Do not hand-edit it. Native configuration lives in `app.config.ts` and config plugins.

## Prerequisites on the Mac (audited)

| Tool | Version |
| --- | --- |
| Xcode | 26.3 (iOS 26.2 SDK) |
| Node / npm | 22.23 / 10.9 |
| CocoaPods | 1.16.2 |
| Signing | One valid "Apple Development" identity |
| eas-cli | 20.5.1, installed, **not logged in** |

## Project configuration

| Setting | Value |
| --- | --- |
| Bundle identifier | `com.jamesjmnz.pulse` |
| Deployment target | iOS 17.0 |
| New Architecture | enabled |
| URL scheme | `pulse` |
| Team ID | Read from the `EXPO_APPLE_TEAM_ID` environment variable |

`.env.example` documents `EXPO_APPLE_TEAM_ID` with a fake placeholder. Put the real value in an untracked `.env.local`. Never commit it.

Permission strings declared in `app.config.ts`: microphone, speech recognition, local network, and the Bonjour service `_pulse-sos._tcp`.

## Prepare each iPhone

1. Connect the iPhone to the Mac by cable and unlock it. Tap **Trust** when asked.
2. Enable Developer Mode: Settings > Privacy & Security > Developer Mode, turn on, restart, confirm.
3. iPhone 17 Pro Max only, for the text model: Settings > Apple Intelligence & Siri, turn Apple Intelligence on, and wait until the model download completes. Do this while online, before any offline test.
4. After the first install, if iOS refuses to open the app: Settings > General > VPN & Device Management, select the developer certificate, tap **Trust**.

Device state today: iPhone 17 Pro Max (iOS 26.6) is paired with the Mac. iPhone 14 Pro Max and iPhone 13 are not yet paired; the owner plans to update them to iOS 26 first.

## Build and install locally

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

The iPhone and the Mac must be able to reach each other for the development bundler. Offline tests need a build that does not depend on the bundler; the profile for that will be defined in Phase 1.

## EAS

`eas.json` does not exist yet. Development and preview profiles will be added in Phase 1.

- Local Xcode builds do not need an Expo account.
- `eas login` is needed only if cloud builds are wanted. It is a human step and has not been done.
- No production submission or App Store release is in scope.

## Known risk

**UNVERIFIED:** whether `@react-native-ai/apple` 0.12.0 builds against React Native 0.86. If it cannot be made to build after three distinct attempts, the project falls back to Expo SDK 54 / React Native 0.81.5. See [TECH_STACK.md](TECH_STACK.md).

## Build log

Record each real attempt here.

| Date | Command | Device | Result | Notes |
| --- | --- | --- | --- | --- |
| — | — | — | — | — |

## Troubleshooting

Empty until a real problem has been met and solved.

## EAS Build (added 2026-10-10)

EAS project: `@jamesjimenezzz/pulse` (linked in `app.config.ts`). Profiles are in `eas.json`.

| Profile | What it produces | Use |
| --- | --- | --- |
| `development` | Dev client, internal distribution | Day-to-day development. Needs Metro running on the Mac, so it is not an offline build. |
| `preview` | Release build with the JS bundle embedded, internal distribution | Offline tests and the demo: runs in airplane mode with no Mac. |
| `production` | Store build | Not used for the hackathon. |

Status: profiles added and the project linked. The first build has not run. A non-interactive attempt stopped at
"couldn't find any credentials suitable for internal distribution"; credentials must be created once, interactively.

One-time interactive steps (they ask for the Apple ID and need a paid Apple Developer Program membership,
because internal distribution uses ad hoc provisioning):

```bash
eas device:create                               # register each iPhone (open the link on the phone)
eas build -p ios --profile development          # creates the certificate and provisioning profile, then builds
eas build -p ios --profile preview              # offline-capable build for the demo
```

After the first interactive build, later builds can run with `--non-interactive`.

UNVERIFIED: that the EAS build image used for SDK 57 ships an Xcode with the iOS 26 SDK that
`@react-native-ai/apple` needs for Foundation Models; and that the two local Swift modules compile there.
