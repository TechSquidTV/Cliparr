import ProviderConnectFlow from "./ProviderConnectFlow";
import type { ProviderSession } from "../providers/types";

interface Props {
  onConnected: (session: ProviderSession) => Promise<void> | void;
}

export default function ProviderConnectScreen({ onConnected }: Props) {
  return (
    <div className="flex min-h-screen items-start justify-center bg-background p-4 pt-6 text-foreground sm:items-center">
      <div className="relative w-full max-w-5xl overflow-hidden rounded-4xl border border-border bg-card text-card-foreground shadow-2xl">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-0 top-0 h-40 bg-linear-to-b from-primary/10 via-secondary/5 to-transparent" />
          <div className="absolute -left-10 top-24 h-40 w-40 rounded-full bg-secondary/10 blur-3xl" />
          <div className="absolute -right-10 top-16 h-44 w-44 rounded-full bg-primary/10 blur-3xl" />
        </div>

        <div className="relative border-b border-border px-6 py-8 sm:px-8">
          <div className="mb-5 flex items-center justify-center">
            <img src="/logo-light.svg" alt="Cliparr Logo" className="h-12 w-12" />
          </div>
          <h1 className="text-center text-3xl font-semibold tracking-tight">Connect A Provider</h1>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-6 text-muted-foreground">
            Select a provider. You will be able to add more providers later.
          </p>
        </div>

        <div className="relative px-6 py-6 sm:px-8">
          <ProviderConnectFlow variant="screen" onConnected={onConnected} />
        </div>
      </div>
    </div>
  );
}
