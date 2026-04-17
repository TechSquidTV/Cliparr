import {createRootRoute, Outlet} from '@tanstack/react-router';

function RootRouteComponent() {
  return <Outlet />;
}

export const Route = createRootRoute({
  component: RootRouteComponent,
});
