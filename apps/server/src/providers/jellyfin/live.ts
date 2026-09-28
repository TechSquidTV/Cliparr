import { createApiError } from "@/http/errors";
import type { MediaSource } from "@/db/mediaSourcesRepository";
import type { PlaybackObserver } from "@/providers/types";
import {
  createJellyfinPlaybackResolver,
  jellyfinPlaybackIdentity,
  visibleJellyfinSessions,
} from "@/providers/jellyfin/playback";
import {
  assertAllowedJellyfinServerUrl,
  fetchCurrentUser,
  fetchPublicSystemInfo,
  fetchSessions,
  jellyfinHeaders,
  sourceContext,
  type JellyfinSessionInfo,
} from "@/providers/jellyfin/shared";
import { readLiveWebSocket } from "@/providers/shared/liveWebSocket";

export function jellyfinSupportsLiveSessions(
  version: string,
  isAdministrator: boolean,
) {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return isAdministrator || major > 10 || (major === 10 && minor >= 11);
}

export async function watchCurrentlyPlaying(
  source: MediaSource,
  observer: PlaybackObserver,
  signal: AbortSignal,
) {
  const context = sourceContext(source);
  const [user, info] = await Promise.all([
    fetchCurrentUser(context),
    fetchPublicSystemInfo({
      baseUrl: context.baseUrl,
      deviceId: context.deviceId,
    }),
  ]);
  signal.throwIfAborted();
  const isAdministrator = user.Policy?.IsAdministrator === true;
  if (!jellyfinSupportsLiveSessions(info.Version ?? "", isAdministrator)) {
    throw createApiError(
      422,
      "live_sessions_unsupported",
      "Live sessions require Jellyfin 10.11 or newer for non-administrator accounts.",
    );
  }
  const { url, addresses } = await assertAllowedJellyfinServerUrl(
    `${context.baseUrl}/socket`,
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const connection = new AbortController();
  const connectionSignal = AbortSignal.any([signal, connection.signal]);
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let initialization: Promise<void> = Promise.resolve();
  let receivedSnapshot = false;
  let identity: string | undefined;
  const resolvePlayback = createJellyfinPlaybackResolver(source, context);
  let failure: Error | undefined;
  const publish = (sessions: JellyfinSessionInfo[]) => {
    if (connectionSignal.aborted) {
      return;
    }
    const active = visibleJellyfinSessions(
      sessions,
      context.userId,
      isAdministrator,
    );
    const nextIdentity = jellyfinPlaybackIdentity(active);
    if (identity !== nextIdentity) {
      identity = nextIdentity;
      observer.snapshot(resolvePlayback(active));
    }
    observer.progress(
      active.map((session) => ({
        sourceId: source.id,
        sessionId: session.Id ?? "",
        playerState: session.PlayState?.IsPaused ? "paused" : "playing",
        playheadSeconds: (session.PlayState?.PositionTicks ?? 0) / 10_000_000,
      })),
    );
  };
  try {
    await readLiveWebSocket({
      url,
      addresses,
      headers: jellyfinHeaders({
        token: context.token,
        deviceId: context.deviceId,
      }),
      signal: connectionSignal,
      onOpen(send) {
        send(JSON.stringify({ MessageType: "SessionsStart", Data: "0,1000" }));
        // Never let an older HTTP response overwrite a newer pushed snapshot.
        initialization = fetchSessions(context)
          .then((sessions) => {
            if (!receivedSnapshot) {
              publish(sessions);
            }
          })
          .catch((error: unknown) => {
            failure = new Error(
              "Could not load the initial Jellyfin sessions",
              { cause: error },
            );
            connection.abort();
          });
      },
      onMessage(text, send) {
        const message = JSON.parse(text) as {
          MessageType?: string;
          Data?: unknown;
        };
        if (message.MessageType === "ForceKeepAlive") {
          if (typeof message.Data !== "number" || message.Data <= 0) {
            throw new Error("Invalid heartbeat");
          }
          clearInterval(heartbeat);
          const keepAlive = () =>
            send(JSON.stringify({ MessageType: "KeepAlive" }));
          keepAlive();
          heartbeat = setInterval(
            keepAlive,
            Math.min(message.Data * 500, 30_000),
          );
          heartbeat.unref();
        } else if (message.MessageType === "Sessions") {
          if (
            !Array.isArray(message.Data) ||
            !message.Data.every(
              (entry: Partial<JellyfinSessionInfo> | null) =>
                entry &&
                typeof entry.Id === "string" &&
                (entry.UserId === undefined ||
                  entry.UserId === null ||
                  typeof entry.UserId === "string"),
            )
          ) {
            throw new Error("Invalid session snapshot");
          }
          receivedSnapshot = true;
          publish(message.Data as JellyfinSessionInfo[]);
        } else if (
          [
            "UserUpdated",
            "UserDeleted",
            "ServerRestarting",
            "ServerShuttingDown",
          ].includes(message.MessageType ?? "")
        ) {
          // Reauthenticate and recheck permissions instead of retaining the old role.
          observer.invalidate();
          connection.abort();
        }
      },
    });
    if (failure) {
      throw failure;
    }
  } finally {
    connection.abort();
    clearInterval(heartbeat);
    await initialization;
  }
}
