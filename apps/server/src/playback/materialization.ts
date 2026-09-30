import type {
  CurrentlyPlayingEntry,
  PlaybackResolver,
} from "@/providers/types";
import type { ProviderSessionRecord } from "@/session/store";

/** Serialize revisions and retry only failed preparation, never poll sessions. */
export function createPlaybackMaterialization(options: {
  session: ProviderSessionRecord;
  onSuccess: (entries: CurrentlyPlayingEntry[]) => void;
  onFailure: (error: unknown, retrying: boolean) => void;
}) {
  let latest: { revision: number; resolve: PlaybackResolver } | undefined;
  let running = false;
  let stopped = false;
  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    if (stopped || running || !latest) {
      return;
    }
    clearTimeout(retry);
    running = true;
    try {
      for (;;) {
        if (!latest || stopped) {
          return;
        }
        const current: NonNullable<typeof latest> = latest;
        try {
          const entries = await current.resolve(options.session);
          if (stopped) {
            return;
          }
          if (current !== latest) {
            continue;
          }
          failures = 0;
          options.onSuccess(entries);
        } catch (error) {
          if (stopped) {
            return;
          }
          if (current !== latest) {
            continue;
          }
          const retrying = ++failures <= 3;
          options.onFailure(error, retrying);
          if (retrying) {
            retry = setTimeout(() => void run(), 1000 * 2 ** (failures - 1));
            retry.unref();
          }
        }
        break;
      }
    } finally {
      running = false;
    }
  };
  return {
    update(revision: number, resolve: PlaybackResolver) {
      if (latest?.revision === revision) {
        return;
      }
      latest = { revision, resolve };
      failures = 0;
      void run();
    },
    retry() {
      failures = 0;
      void run();
    },
    stop() {
      stopped = true;
      clearTimeout(retry);
    },
  };
}
