import { Jellyfin } from "@jellyfin/sdk";
import {
  getItemsApi,
  getPlaystateApi,
  getSessionApi,
  getUserApi,
} from "@jellyfin/sdk/lib/utils/api/index.js";
import { waitUntil } from "#/process.ts";
import type { CaptureScene } from "#/scenes.ts";

export const jellyfinUrl = "http://jellyfin:8096";
export const captureUsername = "capture";

export async function startJellyfinScene(
  scene: CaptureScene,
  password: string,
) {
  const deviceId = `cliparr-www-capture-${scene.name}`;
  const jellyfin = new Jellyfin({
    clientInfo: { name: "Cliparr Website Capture", version: "1.0.0" },
    deviceInfo: { name: `Website ${scene.name}`, id: deviceId },
  });
  const loginApi = jellyfin.createApi(jellyfinUrl);
  const { data: authentication } = await getUserApi(
    loginApi,
  ).authenticateUserByName({
    authenticateUserByName: { Username: captureUsername, Pw: password },
  });
  const userId = authentication.User?.Id;
  if (!authentication.AccessToken || !userId) {
    throw new Error(
      "Capture Jellyfin authentication did not return a user and token.",
    );
  }
  const api = jellyfin.createApi(jellyfinUrl, authentication.AccessToken);
  const item = await waitUntil(
    `${scene.name} to be indexed in Jellyfin`,
    async () => {
      const { data } = await getItemsApi(api).getItems({
        userId,
        recursive: true,
        fields: ["Path", "MediaSources", "MediaStreams"],
        includeItemTypes: ["Movie", "Video"],
      });
      return data.Items?.find(
        (candidate) => candidate.Path === `/media/${scene.mediaPath}`,
      );
    },
  );
  const itemId = item.Id;
  const mediaSource = item.MediaSources?.[0];
  const duration = (item.RunTimeTicks ?? 0) / 10_000_000;
  if (!itemId || !mediaSource?.Id || duration < scene.selection.outSeconds) {
    throw new Error(
      `${scene.name}: source must include the original timeline through ${scene.selection.outSeconds} seconds.`,
    );
  }
  const subtitle = mediaSource.MediaStreams?.find(
    (stream) => stream.Type === "Subtitle" && stream.IsTextSubtitleStream,
  );
  if (subtitle?.Index === undefined || subtitle.Index === null) {
    throw new Error(
      `${scene.name}: provide an embedded text subtitle track or matching subtitle sidecar.`,
    );
  }
  const playstate = getPlaystateApi(api);
  const playback = {
    ItemId: itemId,
    MediaSourceId: mediaSource.Id,
    PositionTicks: Math.round(scene.selection.inSeconds * 10_000_000),
    SubtitleStreamIndex: subtitle.Index,
    IsPaused: true,
    CanSeek: true,
    PlayMethod: "DirectPlay" as const,
  };
  await playstate.reportPlaybackStart({ playbackStartInfo: playback });
  let heartbeatError: Error | null = null;
  let pendingHeartbeat = Promise.resolve();
  const heartbeat = setInterval(() => {
    pendingHeartbeat = pendingHeartbeat
      .then(async () => {
        await playstate.reportPlaybackProgress({
          playbackProgressInfo: playback,
        });
      })
      .catch(() => {
        heartbeatError = new Error(
          `${scene.name}: Jellyfin playback heartbeat failed.`,
        );
      });
  }, 2000);
  return {
    playerTitle: `Website ${scene.name}`,
    check() {
      if (heartbeatError) {
        throw heartbeatError;
      }
    },
    async stop() {
      clearInterval(heartbeat);
      await pendingHeartbeat;
      try {
        await playstate.reportPlaybackStopped({
          playbackStopInfo: {
            ItemId: itemId,
            PositionTicks: playback.PositionTicks,
          },
        });
      } finally {
        await getSessionApi(api).reportSessionEnded();
      }
    },
  };
}
