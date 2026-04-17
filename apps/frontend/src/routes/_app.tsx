import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

function ProtectedRouteLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/_app")({
  beforeLoad: ({ context }): ReturnType<typeof redirect> | void => {
    if (!context.auth.providerSession) {
      return redirect({
        to: "/providers/connect",
        replace: true,
      });
    }
  },
  component: ProtectedRouteLayout,
});
