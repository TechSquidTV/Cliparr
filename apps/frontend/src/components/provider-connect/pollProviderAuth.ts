import type { ProviderSession } from "@cliparr/shared/providers";

import { cliparrClient } from "@/api/cliparrClient";

interface ProviderAuthPollingOptions {
  providerId: string;
  authId: string;
  onConnected: (session: ProviderSession) => Promise<void> | void;
  onComplete: () => void;
  onExpired: () => void;
  onError: (error: unknown) => void;
}

export function pollProviderAuth({
  providerId,
  authId,
  onConnected,
  onComplete,
  onExpired,
  onError,
}: ProviderAuthPollingOptions) {
  let cancelled = false;
  let timer: ReturnType<typeof globalThis.setTimeout>;

  async function poll() {
    try {
      const status = await cliparrClient.pollAuth(providerId, authId);
      if (cancelled) {
        return;
      }

      if (status.status === "complete") {
        const session = await cliparrClient.getSession();
        if (cancelled) {
          return;
        }
        await onConnected(session);
        if (!cancelled) {
          onComplete();
        }
      } else if (status.status === "expired") {
        onExpired();
      } else {
        timer = globalThis.setTimeout(() => void poll(), 1500);
      }
    } catch (error: unknown) {
      if (!cancelled) {
        onError(error);
      }
    }
  }

  timer = globalThis.setTimeout(() => void poll(), 1500);
  return () => {
    cancelled = true;
    globalThis.clearTimeout(timer);
  };
}
