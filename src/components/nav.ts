import type { Href } from 'expo-router';

/** Route table in one place so screens never spell paths by hand. */
export const routes = {
  home: '/' as Href,
  network: '/network' as Href,
  activity: '/activity' as Href,
  settings: '/settings' as Href,
  onboarding: '/welcome' as Href,
  sos: '/sos' as Href,
  pair: '/pair' as Href,
  demoLab: '/demo-lab' as Href,
  localAI: '/demo-lab/local-ai' as Href,
  incident: (id: string) => `/incident/${encodeURIComponent(id)}` as Href,
  report: (id: string) => `/incident/${encodeURIComponent(id)}/report` as Href,
};
