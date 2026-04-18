import {createFileRoute, redirect} from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  beforeLoad: ({ context }): ReturnType<typeof redirect> => {
    return redirect({
      to: context.auth.providerSession ? '/dashboard' : '/providers/connect',
      replace: true,
    });
  },
  component: () => null,
});
