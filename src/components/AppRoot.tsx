import { router, usePathname } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AppMode, PulseApp } from '@/services/api';
import { PulseProvider, usePulse } from '@/services/PulseProvider';
import { OverlayHost, ToastHost } from '@/ui';

import { useAppMode } from './appMode';
import { AnomalySheet } from './demo/AnomalySheet';
import { routes } from './nav';
import { Splash } from './onboarding/Splash';
import { SimulatedBar } from './SimulatedBar';

type Factory = () => PulseApp | Promise<PulseApp>;

/**
 * The service layer is expected to export two factories from `@/services`:
 *   - `createLiveApp()`  returns the LIVE PulseApp (SQLite, Callstack Apple AI, native transport and crypto)
 *   - `createDemoApp()`  returns the DEMO PulseApp (in-memory, scripted, simulated)
 * They are resolved lazily so this file typechecks and tests run before that module exists; when a
 * factory is missing the app says so plainly instead of showing invented data.
 */
function loadFactory(mode: AppMode): Factory | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const services: unknown = require('@/services');
    if (typeof services !== 'object' || services === null) return null;
    const candidate: unknown = (services as Record<string, unknown>)[mode === 'demo' ? 'createDemoApp' : 'createLiveApp'];
    return typeof candidate === 'function' ? (candidate as Factory) : null;
  } catch {
    return null;
  }
}

/** The design's splash, shown while storage, identity and capabilities load. Never shows data. */
export function StartingScreen({ message }: { message?: string }) {
  return (
    <View accessible={false} accessibilityLabel="Starting" style={{ flex: 1 }}>
      <Splash testID="starting-screen" message={message} />
    </View>
  );
}

function ShellBody({ children }: { children: ReactNode }) {
  const snapshot = usePulse();
  const insets = useSafeAreaInsets();
  const demo = snapshot.mode === 'demo';
  // A pairing session can be started by the other phone. Its code has to be compared on both, so the
  // comparison opens here too; without this the receiving phone shows nothing.
  const pathname = usePathname();
  const onPairScreen = useRef(false);
  useEffect(() => {
    onPairScreen.current = pathname === routes.pair;
  }, [pathname]);
  const pairingPeer = snapshot.ready ? (snapshot.pairing?.peerDeviceId ?? null) : null;
  useEffect(() => {
    if (pairingPeer !== null && !onPairScreen.current) router.push(routes.pair);
  }, [pairingPeer]);
  // Sheets, dialogs and toasts live inside this area, so in Demo they are always under the SIMULATED bar.
  const body = (
    <>
      {snapshot.ready ? children : <StartingScreen />}
      <OverlayHost />
      {demo ? <AnomalySheet /> : null}
      <ToastHost />
    </>
  );
  return (
    <View className="flex-1 bg-page">
      {demo ? <SimulatedBar /> : null}
      <View className="flex-1">
        {demo ? (
          // The bar already covers the top inset, so screens below it must not add it again.
          <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>{body}</SafeAreaInsetsContext.Provider>
        ) : (
          body
        )}
      </View>
    </View>
  );
}

/** Provider + SIMULATED bar + ready gate around the navigator. Tests mount this with a fake app. */
export function PulseShell({ app, children }: { app: PulseApp; children: ReactNode }) {
  return (
    <PulseProvider app={app}>
      <ShellBody>{children}</ShellBody>
    </PulseProvider>
  );
}

type Loaded = { mode: AppMode; app: PulseApp | null; error: string | null };

/** Creates the PulseApp for the current mode and swaps it when Demo Lab changes the mode. */
export function AppRoot({ children }: { children: ReactNode }) {
  const mode = useAppMode((s) => s.mode);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: PulseApp | null = null;
    Promise.resolve()
      .then(() => {
        const factory = loadFactory(mode);
        if (!factory) throw new Error('missing_factory');
        return factory();
      })
      .then((app) => {
        if (cancelled) {
          void app.dispose();
          return;
        }
        created = app;
        setLoaded({ mode, app, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const missing = error instanceof Error && error.message === 'missing_factory';
        setLoaded({ mode, app: null, error: missing ? 'App services are not available in this build.' : 'SAGIP could not start its local services.' });
      });
    return () => {
      cancelled = true;
      if (created) void created.dispose();
    };
  }, [mode]);

  if (!loaded || loaded.mode !== mode) return <StartingScreen />;
  if (!loaded.app) return <StartingScreen message={loaded.error ?? undefined} />;
  return <PulseShell app={loaded.app}>{children}</PulseShell>;
}
