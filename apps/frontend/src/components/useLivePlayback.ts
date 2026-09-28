import { useCallback, useEffect, useState } from "react";
import {
  applyPlaybackProgress,
  type PlaybackSnapshot,
} from "@cliparr/shared/providers";
import { cliparrClient } from "@/api/cliparrClient";
import type { PlaybackConnectionState } from "@/api/playbackStream";

const initialSnapshot: PlaybackSnapshot = {
  viewers: [],
  sourceErrors: [],
  sources: [],
  loading: true,
};

export function useLivePlayback() {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [connection, setConnection] =
    useState<PlaybackConnectionState>("connecting");
  const [attempt, setAttempt] = useState(0);
  useEffect(
    () =>
      cliparrClient.subscribeCurrentlyPlaying({
        onConnection: setConnection,
        onEvent(event) {
          if (event.type === "snapshot") {
            setSnapshot(event.snapshot);
          } else if (event.type === "progress") {
            setSnapshot((current) => {
              const viewers = applyPlaybackProgress(
                current.viewers,
                event.updates,
              );
              return viewers === current.viewers
                ? current
                : { ...current, viewers };
            });
          }
        },
      }),
    [attempt],
  );

  const retry = useCallback(() => {
    void cliparrClient
      .retryLivePlayback()
      .catch(() => {})
      .finally(() => {
        if (connection !== "live") {
          setAttempt((value) => value + 1);
        }
      });
  }, [connection]);
  return { ...snapshot, connection, retry };
}
