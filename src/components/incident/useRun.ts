import { useCallback, useState } from 'react';

import type { ActionResult } from '@/services/api';
import { colors, useToast } from '@/ui';

/**
 * Runs a ledger action, blocks double taps while it is pending, and surfaces a refusal as a toast.
 * Success is never announced here: the screen changes only when the snapshot does.
 */
export function useRun() {
  const [busy, setBusy] = useState<string | null>(null);
  const show = useToast((s) => s.show);
  const run = useCallback(
    async <T,>(key: string, action: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> => {
      setBusy(key);
      let result: ActionResult<T>;
      try {
        result = await action();
      } catch {
        result = { ok: false, code: 'unexpected', message: 'That did not work. Nothing was changed.' };
      }
      setBusy(null);
      if (!result.ok) show(result.message.length > 0 ? result.message : 'That did not work. Nothing was changed.', 'error', colors.amber);
      return result;
    },
    [show],
  );
  return { busy, run };
}
