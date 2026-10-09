/**
 * Composition root for screens: `createLiveApp()` and `createDemoApp()` both return a `PulseApp`
 * (see `./api`). Importing this file loads no native module; LIVE adapters are imported lazily
 * inside `createLiveApp`.
 */
export type * from './api';
export { createLiveApp } from './live';
export { createDemoApp, type DemoApp, type DemoAppOptions } from '@/demo/createDemoApp';
export { PulseProvider, usePulse, usePulseActions } from './PulseProvider';
