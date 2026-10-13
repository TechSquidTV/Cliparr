import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

import type { RouterContext } from "@/router";

function RootRouteComponent() {
  return <Outlet />;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: ({ context }) => {
    if (!context.auth) {
      throw new Error("Router authentication context is missing.");
    }
    return { auth: context.auth };
  },
  component: RootRouteComponent,
});
