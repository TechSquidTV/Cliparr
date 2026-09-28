import type { MediaSource } from "@/db/mediaSourcesRepository";
import type {
  PlaybackObserver,
  ProviderImplementation,
} from "@/providers/types";
import type { PlaybackSourceStatus } from "@cliparr/shared/providers";
import { logEventFields } from "@cliparr/shared/logging";
import { isApiError } from "@/http/errors";
import { getServerLogger } from "@/logging";

const logger = getServerLogger(["media", "discovery"]);
const disconnectedMessage =
  "Live updates disconnected. Reconnecting automatically; displayed sessions may be out of date.";

/** Inspect nested failures without logging upstream URLs, credentials or payloads. */
function apiFailure(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 8; depth++) {
    if (isApiError(current)) {
      return current;
    }
    if (!(current instanceof Error)) {
      return;
    }
    current = current.cause;
  }
}

export function startSourceConnection(options: {
  source: MediaSource;
  provider: ProviderImplementation | undefined;
  observer: PlaybackObserver;
  signal: AbortSignal;
  onStatus: (state: PlaybackSourceStatus["state"], message?: string) => void;
}) {
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let lastState: PlaybackSourceStatus["state"] = "connecting";
  let lastMessage: string | undefined;
  const transition = (
    state: PlaybackSourceStatus["state"],
    message?: string,
    error?: unknown,
  ) => {
    if (
      options.signal.aborted ||
      (state === lastState && message === lastMessage)
    ) {
      return;
    }
    lastMessage = message;
    if (state !== lastState) {
      const failure = apiFailure(error);
      const fields = {
        ...logEventFields("media.live.connection", state),
        "source.id": options.source.id,
        "provider.id": options.source.providerId,
        "connection.previous_state": lastState,
        "error.name": error instanceof Error ? error.name : undefined,
        "error.code": failure?.code,
        "http.response.status_code": failure?.status,
      };
      if (state === "live" || state === "connecting") {
        logger.info("Live playback connection changed.", fields);
      } else {
        logger.warn("Live playback connection interrupted.", fields);
      }
      lastState = state;
    }
    options.onStatus(state, message);
  };
  const connect = async () => {
    if (options.signal.aborted) {
      return;
    }
    const startedAt = Date.now();
    try {
      if (!options.provider) {
        throw new Error("Unknown provider");
      }
      await options.provider.watchCurrentlyPlaying(
        options.source,
        {
          ...options.observer,
          snapshot(resolve) {
            transition("live");
            options.observer.snapshot(resolve);
          },
          invalidate() {
            options.observer.invalidate();
            transition("connecting");
          },
        },
        options.signal,
      );
      if (!options.signal.aborted) {
        transition("reconnecting", disconnectedMessage);
      }
    } catch (error) {
      if (options.signal.aborted) {
        return;
      }
      const failure = apiFailure(error);
      if (!options.provider || failure?.code === "live_sessions_unsupported") {
        transition(
          "unsupported",
          failure?.message ?? "This provider does not support live sessions.",
          error,
        );
        return;
      }
      if (failure?.status === 401 || failure?.status === 403) {
        options.observer.invalidate();
        transition(
          "error",
          "Source authentication expired. Reconnect it in Sources.",
          error,
        );
        return;
      }
      transition("reconnecting", disconnectedMessage, error);
    }
    if (options.signal.aborted) {
      return;
    }
    attempts = Date.now() - startedAt > 30_000 ? 0 : attempts + 1;
    retry = setTimeout(
      () => void connect(),
      Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5)) + Math.random() * 500,
    );
    retry.unref();
  };
  options.signal.addEventListener("abort", () => clearTimeout(retry), {
    once: true,
  });
  void connect();
}
