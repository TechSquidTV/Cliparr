import {createRootRouteWithContext, Outlet} from '@tanstack/react-router';
import type { RouterContext } from '../router';

function RootRouteComponent() {
  return <Outlet />;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootRouteComponent,
});
