/**
 * In-memory PeerTransport hub for Jest. The implementation lives in `src/demo/` because the Demo
 * Lab uses the same simulated radio and app code may not import from `testing/` directories.
 */
export { createMemoryHub, type HubTap, type LinkFault, type MemoryHub } from '@/demo/memoryHub';
