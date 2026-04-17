import {createRouter} from '@tanstack/react-router';
import type { ProviderSession } from './providers/types';
import {routeTree} from './routeTree.gen';

export interface RouterAuthContext {
  providerSession: ProviderSession | null;
  setProviderSession: (session: ProviderSession | null) => void;
  logout: () => Promise<void>;
}

export interface RouterContext {
  auth: RouterAuthContext;
}

export const router = createRouter({
  routeTree,
  context: {
    auth: undefined!,
  },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
