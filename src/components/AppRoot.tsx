import { useEffect, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AppMode, PulseApp } from '@/services/api';
import { PulseProvider, usePulse } from '@/services/PulseProvider';
import { ToastHost } from '@/ui';

import { useAppMode } from './appMode';
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

export function StartingScreen({ message }: { message?: string }) {
  return (
    <View testID="starting-screen" className="flex-1 items-center justify-center gap-2 bg-page px-8">
      <Text accessibilityRole="header" accessibilityLiveRegion="polite" className="text-[20px] font-bold text-ink">
        Starting…
      </Text>
      {message ? <Text className="text-center text-[14px] leading-[20px] text-gray-1">{message}</Text> : null}
    </View>
  );
}

function ShellBody({ children }: { children: ReactNode }) {
  const snapshot = usePulse();
  const insets = useSafeAreaInsets();
  const demo = snapshot.mode === 'demo';
  const body = snapshot.ready ? children : <StartingScreen />;
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
      <ToastHost />
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
        setLoaded({ mode, app: null, error: missing ? 'App services are not available in this build.' : 'PULSE could not start its local services.' });
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
