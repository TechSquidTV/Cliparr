import {createFileRoute} from '@tanstack/react-router';
import App from '../App';

function IndexRouteComponent() {
  return <App />;
}

export const Route = createFileRoute('/')({
  component: IndexRouteComponent,
});
