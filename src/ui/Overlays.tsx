import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { Icon, type IconName } from './Icon';
import { colors } from './theme';

type SheetProps = { visible: boolean; onClose: () => void; title?: string; children: ReactNode; dismissable?: boolean };

/** Bottom sheet with grabber. Scrim tap closes unless `dismissable` is false. */
export function Sheet({ visible, onClose, title, children, dismissable = true }: SheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={dismissable ? onClose : undefined}>
      <Pressable accessibilityLabel="Close" accessibilityRole="button" className="flex-1 bg-black/40" onPress={dismissable ? onClose : undefined} />
      <View className="max-h-[88%] rounded-t-sheet bg-card px-[22px] pt-[10px]" style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}>
        <View className="mb-3 h-[5px] w-[38px] self-center rounded-full bg-line-track" />
        {title ? (
          <Text accessibilityRole="header" className="mb-3 text-[26px] font-bold tracking-[-0.7px] text-ink">
            {title}
          </Text>
        ) : null}
        <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="gap-3 pb-2">
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

type DialogProps = {
  visible: boolean;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function Dialog({ visible, title, message, cancelLabel, confirmLabel, destructive, onCancel, onConfirm }: DialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-black/40">
        <View accessibilityViewIsModal className="w-[280px] overflow-hidden rounded-[18px] bg-card">
          <View className="gap-1 px-5 py-5">
            <Text className="text-center text-[17px] font-semibold text-ink">{title}</Text>
            <Text className="text-center text-[13.5px] leading-[18px] text-gray-2">{message}</Text>
          </View>
          <View className="flex-row border-t border-line-input">
            <Pressable accessibilityRole="button" onPress={onCancel} className="h-[46px] flex-1 items-center justify-center border-r border-line-input">
              <Text className="text-[16px] text-ink">{cancelLabel}</Text>
            </Pressable>
            <Pressable testID="dialog-confirm" accessibilityRole="button" onPress={onConfirm} className="h-[46px] flex-1 items-center justify-center">
              <Text className={`text-[16px] font-bold ${destructive ? 'text-coral-text' : 'text-ink'}`}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
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
  show: (message, icon = 'info', color = '#FFFFFF') => {
    toastSeq += 1;
    const id = toastSeq;
    set({ toast: { id, message, icon, color } });
    setTimeout(() => get().clear(id), 2600);
  },
  clear: (id) => {
    if (get().toast?.id === id) set({ toast: null });
  },
}));

/** Mount once at the root. */
export function ToastHost() {
  const toast = useToast((s) => s.toast);
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  return (
    <View pointerEvents="none" className="absolute left-0 right-0 items-center" style={{ top: insets.top + 6 }}>
      <View accessibilityLiveRegion="polite" accessibilityRole="alert" className="max-w-[90%] flex-row items-center gap-2 rounded-full px-4 py-3" style={{ backgroundColor: colors.ink }}>
        <Icon name={toast.icon} size={18} color={toast.color} filled />
        <Text numberOfLines={2} className="text-[14px] font-semibold text-white">
          {toast.message}
        </Text>
      </View>
    </View>
  );
}
