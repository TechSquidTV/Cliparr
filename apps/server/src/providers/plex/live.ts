import { createApiError } from "@/http/errors";
import { readServerEvents } from "@cliparr/shared/server-events";
import type { MediaSource } from "@/db/mediaSourcesRepository";
import type { PlaybackObserver } from "@/providers/types";
import {
  fetchCurrentlyPlayingData,
  createPlexPlaybackResolver,
} from "@/providers/plex/playback";
import { openPlexEventStream } from "@/providers/plex/pmsClient";
import { plexMediaHeaders } from "@/providers/plex/shared";

interface PlexPlayingNotification {
  sessionKey?: string | number;
  state?: string;
  ratingKey?: string | number;
  viewOffset?: number;
}

export function readPlexPlayingNotifications(
  text: string,
): PlexPlayingNotification[] {
  const message = JSON.parse(text) as {
    NotificationContainer?: {
      PlaySessionStateNotification?: PlexPlayingNotification[];
    };
    PlaySessionStateNotification?:
      | PlexPlayingNotification
      | PlexPlayingNotification[];
  };
  const notifications =
    message.NotificationContainer?.PlaySessionStateNotification ??
    message.PlaySessionStateNotification;
  if (!notifications) {
    return [];
  }
  const entries = Array.isArray(notifications)
    ? notifications
    : [notifications];
  return entries.filter(
    (entry) =>
      entry &&
      (typeof entry.sessionKey === "string" ||
        typeof entry.sessionKey === "number") &&
      typeof entry.state === "string",
  );
}

export async function watchCurrentlyPlaying(
  source: MediaSource,
  observer: PlaybackObserver,
  signal: AbortSignal,
) {
  // Resolve the same reachable PMS connection as ordinary playback discovery.
  const initial = await fetchCurrentlyPlayingData(source);
  signal.throwIfAborted();
  const resolvePlayback = createPlexPlaybackResolver(source, initial.context);
  const controller = new AbortController();
  const connectionSignal = AbortSignal.any([signal, controller.signal]);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const activity = (milliseconds = 45_000) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      failure = createApiError(
        504,
        "live_connection_stalled",
        "Plex notification stream stopped responding",
      );
      controller.abort();
    }, milliseconds);
  };
  let refresh: Promise<void> | undefined;
  let dirty = false;
  let failure: Error | undefined;
  activity(10_000);
  const identities = new Map<string, string>();
  const refreshSnapshot = () => {
    dirty = true;
    refresh ??= (async () => {
      while (dirty && !connectionSignal.aborted) {
        dirty = false;
        const { context, data } = await fetchCurrentlyPlayingData(source);
        if (connectionSignal.aborted) {
          return;
        }
        if (context.baseUrl !== initial.context.baseUrl) {
          throw new Error("Plex connection changed");
        }
        if (dirty) {
          continue;
        }
        observer.snapshot(resolvePlayback(data));
      }
    })()
      .catch((error: unknown) => {
        failure = new Error("Could not synchronize Plex sessions", {
          cause: error,
        });
        controller.abort();
      })
      .finally(() => {
        refresh = undefined;
      });
  };
  try {
    const body = await openPlexEventStream(
      initial.context,
      plexMediaHeaders(),
      connectionSignal,
    );
    activity();
    const stream = readServerEvents(
      body,
      (_event, text) => {
        for (const entry of readPlexPlayingNotifications(text)) {
          const sessionId = String(entry.sessionKey);
          const identity = JSON.stringify([entry.ratingKey, entry.state]);
          if (identities.get(sessionId) !== identity) {
            identities.set(sessionId, identity);
            refreshSnapshot();
          }
          if (entry.state !== "stopped") {
            observer.progress([
              {
                sourceId: source.id,
                sessionId,
                playerState: entry.state ?? "playing",
                playheadSeconds:
                  typeof entry.viewOffset === "number"
                    ? entry.viewOffset / 1000
                    : undefined,
              },
            ]);
          }
        }
      },
      activity,
    );
    // Fetch after subscribing and keep draining events during the request.
    refreshSnapshot();
    try {
      await stream;
    } catch (error) {
      throw failure ?? error;
    }
    if (failure) {
      throw failure;
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
    await refresh;
  }
}
