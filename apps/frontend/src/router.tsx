import type { ProviderSession } from "@cliparr/shared/providers";
import { createRouter } from "@tanstack/react-router";

import { routeTree } from "@/routeTree.gen";

export interface RouterAuthContext {
  providerSession: ProviderSession | null;
  setProviderSession: (session: ProviderSession | null) => void;
  disconnect: () => Promise<void>;
}

export interface RouterContext {
  auth: RouterAuthContext | undefined;
}

export const router = createRouter({
  routeTree,
  context: {
    auth: undefined,
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
