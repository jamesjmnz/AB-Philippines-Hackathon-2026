import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { Icon, type IconName } from './Icon';
import { Enter, SheetUp } from './Motion';
import { colors, design, padBottom } from './theme';

/**
 * Sheets and dialogs are drawn in the React tree, not in a native `Modal`, so they sit inside the
 * shell: below the SIMULATED bar in Demo, above the tab bar and every screen. `OverlayHost` is mounted
 * once by the shell; a `Sheet` or `Dialog` anywhere below the provider renders into it.
 */
type Entry = { node: ReactNode; z: number };
type OverlayState = {
  hosts: number;
  entries: Record<number, Entry>;
  put: (id: number, entry: Entry) => void;
  drop: (id: number) => void;
  mount: (delta: number) => void;
};

const useOverlays = create<OverlayState>((set) => ({
  hosts: 0,
  entries: {},
  put: (id, entry) => set((s) => ({ entries: { ...s.entries, [id]: entry } })),
  drop: (id) =>
    set((s) => {
      if (!(id in s.entries)) return s;
      const next = { ...s.entries };
      delete next[id];
      return { entries: next };
    }),
  mount: (delta) => set((s) => ({ hosts: s.hosts + delta })),
}));

let overlaySeq = 0;

function Portal({ z, children }: { z: number; children: ReactNode }) {
  const hosted = useOverlays((s) => s.hosts > 0);
  const [id] = useState(() => {
    overlaySeq += 1;
    return overlaySeq;
  });
  // Runs after every render so the hosted copy always shows the caller's latest children.
  useEffect(() => {
    if (hosted) useOverlays.getState().put(id, { node: children, z });
  });
  useEffect(() => () => useOverlays.getState().drop(id), [id]);
  // Without a host (a component rendered on its own in a test) the overlay is drawn in place.
  if (hosted) return null;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {children}
    </View>
  );
}

/** Mount once, after the navigator, inside the provider. */
export function OverlayHost() {
  const entries = useOverlays((s) => s.entries);
  useEffect(() => {
    useOverlays.getState().mount(1);
    return () => useOverlays.getState().mount(-1);
  }, []);
  const ids = Object.keys(entries)
    .map(Number)
    .sort((a, b) => (entries[a]?.z ?? 0) - (entries[b]?.z ?? 0) || a - b);
  if (ids.length === 0) return null;
  return (
    <View testID="overlay-host" pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {ids.map((id) => (
        <View key={id} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          {entries[id]?.node}
        </View>
      ))}
    </View>
  );
}

type SheetProps = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Scrim tap closes unless false (the unusual-movement sheet cannot be dismissed). */
  dismissable?: boolean;
  /** Space under the grabber: 18 in the design, 16 on the unusual-movement sheet. */
  grabberGap?: number;
  /** Centres the content (unusual-movement sheet). */
  centered?: boolean;
  /** Optional heading in the design's sheet title style (26pt extrabold, -0.8 tracking). */
  title?: string;
  testID?: string;
};

/**
 * Bottom sheet (design 809–887): white, 32pt top corners, padding 10/22/40, 38×5 grabber, at most 88%
 * of the height, scrim rgba(10,10,12,.4) fading in over .25s, sheetUp over .42s.
 */
export function Sheet({ visible, onClose, children, dismissable = true, grabberGap = 18, centered, title, testID }: SheetProps) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  return (
    <Portal z={31}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Enter kind="fadeIn" duration={250} style={StyleSheet.absoluteFill}>
          <Pressable
            testID="sheet-scrim"
            accessibilityRole={dismissable ? 'button' : undefined}
            accessibilityLabel={dismissable ? 'Close' : undefined}
            accessible={dismissable}
            onPress={dismissable ? onClose : undefined}
            style={{ flex: 1, backgroundColor: design.scrim }}
          />
        </Enter>
        <SheetUp testID={testID} style={{ maxHeight: '88%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 32, borderTopRightRadius: 32 }}>
          <ScrollView
            accessibilityViewIsModal
            bounces={false}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[{ paddingTop: 10, paddingHorizontal: 22, paddingBottom: padBottom(insets.bottom) }, centered ? { alignItems: 'center' } : null]}>
            <View style={{ width: 38, height: 5, borderRadius: 3, backgroundColor: colors.track, alignSelf: 'center', marginBottom: grabberGap }} />
            {title ? (
              <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: '800', letterSpacing: -0.8, color: colors.ink, marginBottom: 12 }}>
                {title}
              </Text>
            ) : null}
            {children}
          </ScrollView>
        </SheetUp>
      </KeyboardAvoidingView>
    </Portal>
  );
}

type DialogProps = {
  visible: boolean;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  /** Coral confirm label. */
  destructive?: boolean;
  /** Explicit confirm colour (the design uses green for "Resolve"). Wins over `destructive`. */
  confirmColor?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Alert (design 889–899): 280pt wide, radius 18, rgba(250,250,252,.98), 46pt buttons, popIn .25s. */
export function Dialog({ visible, title, message, cancelLabel, confirmLabel, destructive, confirmColor, onCancel, onConfirm }: DialogProps) {
  if (!visible) return null;
  return (
    <Portal z={40}>
      <Enter kind="fadeIn" duration={200} style={[StyleSheet.absoluteFill, { backgroundColor: design.scrim, alignItems: 'center', justifyContent: 'center' }]}>
        <Enter kind="popIn" duration={250} ease="spring" style={{ width: 280, borderRadius: 18, overflow: 'hidden', backgroundColor: 'rgba(250,250,252,0.98)' }}>
          <View accessibilityViewIsModal accessibilityRole="alert">
            <View style={{ paddingTop: 20, paddingHorizontal: 18, paddingBottom: 16 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>{title}</Text>
              <Text style={{ fontSize: 13, lineHeight: 18.2, color: colors.gray2, textAlign: 'center', marginTop: 6 }}>{message}</Text>
            </View>
            <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.lineInput }}>
              <Pressable
                testID="dialog-cancel"
                accessibilityRole="button"
                onPress={onCancel}
                style={{ flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderRightColor: colors.lineInput }}>
                <Text style={{ fontSize: 16, color: colors.ink }}>{cancelLabel}</Text>
              </Pressable>
              <Pressable testID="dialog-confirm" accessibilityRole="button" onPress={onConfirm} style={{ flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: confirmColor ?? (destructive ? colors.coralText : colors.ink) }}>{confirmLabel}</Text>
              </Pressable>
            </View>
          </View>
        </Enter>
      </Enter>
    </Portal>
  );
}

type ToastState = {
  toast: { id: number; message: string; icon: IconName; color: string } | null;
  show: (message: string, icon?: IconName, color?: string) => void;
  clear: (id: number) => void;
};

let toastSeq = 0;

export const useToast = create<ToastState>((set, get) => ({
  toast: null,
  show: (message, icon = 'check_circle', color = '#FFFFFF') => {
    toastSeq += 1;
    const id = toastSeq;
    set({ toast: { id, message, icon, color } });
    setTimeout(() => get().clear(id), 2600);
  },
  clear: (id) => {
    if (get().toast?.id === id) set({ toast: null });
  },
}));

/**
 * Toast (design 911–913): ink pill 4pt under the status-bar inset, padding 11/16, 14pt semibold, 18pt
 * filled icon, shadow 0 10px 30px rgba(0,0,0,.2), toastIn .35s. Mount once at the root, last.
 */
export function ToastHost() {
  const toast = useToast((s) => s.toast);
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: insets.top + 4, alignItems: 'center' }}>
      <Enter key={toast.id} kind="toastIn" duration={350} ease="spring" style={{ maxWidth: 340, marginHorizontal: 16 }}>
        <View
          testID="toast"
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: colors.ink,
            borderRadius: 999,
            paddingVertical: 11,
            paddingHorizontal: 16,
            shadowColor: '#000000',
            shadowOpacity: 0.2,
            shadowRadius: 30,
            shadowOffset: { width: 0, height: 10 },
          }}>
          <Icon name={toast.icon} size={18} color={toast.color} filled />
          <Text numberOfLines={2} style={{ flexShrink: 1, fontSize: 14, fontWeight: "600", color: "#FFFFFF" }}>
            {toast.message}
          </Text>
        </View>
      </Enter>
    </View>
  );
}
