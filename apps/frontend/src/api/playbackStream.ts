import { readServerEvents } from "@cliparr/shared/server-events";
import type { PlaybackStreamEvent } from "@cliparr/shared/providers";

export type PlaybackConnectionState = "connecting" | "live" | "reconnecting";

export function subscribePlaybackStream(options: {
  onEvent: (event: PlaybackStreamEvent) => void;
  onConnection: (state: PlaybackConnectionState) => void;
  onUnauthorized: () => void;
  onRedirect: (response: Response) => boolean;
}) {
  const controller = new AbortController();
  const browserWindow = typeof window === "undefined" ? undefined : window;
  let activeConnection: AbortController | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  const connect = async () => {
    if (controller.signal.aborted) {
      return;
    }
    if (browserWindow && !browserWindow.navigator.onLine) {
      options.onConnection("reconnecting");
      return;
    }
    options.onConnection(attempts === 0 ? "connecting" : "reconnecting");
    const connection = new AbortController();
    activeConnection = connection;
    const signal = AbortSignal.any([controller.signal, connection.signal]);
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let terminal = false;
    const resetWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => connection.abort(), 45_000);
    };
    try {
      resetWatchdog();
      const response = await fetch("/api/media/live", {
        signal,
        headers: { Accept: "text/event-stream" },
      });
      if (signal.aborted) {
        return;
      }
      if (response.status === 401 || options.onRedirect(response)) {
        terminal = true;
        controller.abort();
        options.onUnauthorized();
        await response.body?.cancel();
        return;
      }
      if (
        !response.ok ||
        !response.headers.get("content-type")?.includes("text/event-stream") ||
        !response.body
      ) {
        await response.body?.cancel();
        throw new Error("Could not connect to live updates");
      }
      await readServerEvents(response.body, (name, data) => {
        if (signal.aborted || terminal) {
          return;
        }
        resetWatchdog();
        if (name !== "playback") {
          return;
        }
        const event = JSON.parse(data) as PlaybackStreamEvent;
        if (event.type === "unauthorized") {
          terminal = true;
          controller.abort();
          options.onUnauthorized();
          connection.abort();
          return;
        }
        if (event.type === "snapshot") {
          options.onConnection("live");
          attempts = 0;
        }
        options.onEvent(event);
      });
    } catch {
      // Preserve the latest dashboard snapshot while the connection recovers.
    } finally {
      clearTimeout(watchdog);
      connection.abort();
      if (
        !controller.signal.aborted &&
        !terminal &&
        activeConnection === connection
      ) {
        options.onConnection("reconnecting");
        attempts++;
        if (!browserWindow || browserWindow.navigator.onLine) {
          retryTimer = setTimeout(
            () => {
              void connect();
            },
            Math.min(30_000, 1000 * 2 ** Math.min(attempts - 1, 5)),
          );
        }
      }
    }
  };
  const offline = () => {
    options.onConnection("reconnecting");
    activeConnection?.abort();
    clearTimeout(retryTimer);
  };
  const online = () => {
    clearTimeout(retryTimer);
    activeConnection?.abort();
    void connect();
  };
  browserWindow?.addEventListener("offline", offline);
  browserWindow?.addEventListener("online", online);
  void connect();
  return () => {
    controller.abort();
    clearTimeout(retryTimer);
    browserWindow?.removeEventListener("offline", offline);
    browserWindow?.removeEventListener("online", online);
  };
}
