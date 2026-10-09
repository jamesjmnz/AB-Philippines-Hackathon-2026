import { useMemo } from 'react';

import type { Actor } from '@/domain';
import { usePulse } from '@/services/PulseProvider';

/** This device as a domain actor, for the `can*` policy checks. Identity is the device id. */
export function useActor(): Actor {
  const { me } = usePulse();
  return useMemo(() => ({ deviceId: me.deviceId, userName: me.name.trim().length > 0 ? me.name : 'This device' }), [me.deviceId, me.name]);
}
