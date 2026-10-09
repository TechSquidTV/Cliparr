import { normalizeExportVideoCodec } from "@cliparr/shared/providers";
import type {
  PlaybackAudioSelection,
  PlaybackExportEstimateMetadata,
} from "@/providers/types";
import {
  asArray,
  numberValue,
  stringValue,
} from "@/providers/shared/utilities";
import {
  booleanValue,
  type JellyfinItem,
  type JellyfinMediaSource,
  type JellyfinMediaStream,
  type JellyfinPlaybackInfo,
  type JellyfinSessionInfo,
  type JellyfinSourceContext,
} from "@/providers/jellyfin/shared";

export function ticksToSeconds(value: number | null | undefined) {
  const ticks = Number(value);
  if (!Number.isFinite(ticks) || ticks <= 0) {
    return 0;
  }

  return ticks / 10_000_000;
}

function playbackMediaSources(
  sessionInfo: JellyfinSessionInfo | undefined,
  item: JellyfinItem,
  playbackInfo?: JellyfinPlaybackInfo,
) {
  return [
    ...asArray(playbackInfo?.MediaSources),
    ...asArray(item?.MediaSources),
    ...asArray(sessionInfo?.NowPlayingItem?.MediaSources),
  ];
}

export function currentMediaSourceId(
  sessionInfo: JellyfinSessionInfo,
  item: JellyfinItem,
  playbackInfo?: JellyfinPlaybackInfo,
) {
  const playbackInfoMediaSources = asArray(playbackInfo?.MediaSources);
  const playStateMediaSourceId = stringValue(
    sessionInfo?.PlayState?.MediaSourceId,
  );
  if (
    playStateMediaSourceId &&
    playbackInfoMediaSources.some(
      (mediaSource) => stringValue(mediaSource?.Id) === playStateMediaSourceId,
    )
  ) {
    return playStateMediaSourceId;
  }

  return (
    stringValue(playbackInfoMediaSources[0]?.Id) ??
    playStateMediaSourceId ??
    stringValue(asArray(item?.MediaSources)[0]?.Id) ??
    stringValue(asArray(sessionInfo?.NowPlayingItem?.MediaSources)[0]?.Id)
  );
}

export function currentMediaSource(
  sessionInfo: JellyfinSessionInfo | undefined,
  item: JellyfinItem,
  mediaSourceId?: string,
  playbackInfo?: JellyfinPlaybackInfo,
) {
  const mediaSources = playbackMediaSources(sessionInfo, item, playbackInfo);
  if (mediaSourceId) {
    const matchingMediaSource = mediaSources.find(
      (mediaSource) => stringValue(mediaSource?.Id) === mediaSourceId,
    );
    if (matchingMediaSource) {
      return matchingMediaSource;
    }
  }

  return mediaSources[0];
}

export function normalizedString(value: string | null | undefined) {
  return stringValue(value)?.toLowerCase() ?? "";
}

export function isAudioMediaStream(stream: JellyfinMediaStream) {
  return normalizedString(stream?.Type) === "audio";
}

export function isVideoMediaStream(stream: JellyfinMediaStream) {
  return normalizedString(stream?.Type) === "video";
}

export function isSubtitleMediaStream(stream: JellyfinMediaStream) {
  return normalizedString(stream?.Type) === "subtitle";
}

function streamIndexValue(value: unknown) {
  if (value === null || value === undefined) {
    return;
  }

  const index = numberValue(value);
  return index !== undefined && index >= 0 ? index : undefined;
}

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function bpsToKbps(value: unknown) {
  const bps = positiveNumber(value);
  return bps === undefined ? undefined : Math.round(bps / 1000);
}

function firstDefaultOrFirst<T extends { IsDefault?: unknown }>(
  entries: readonly T[],
) {
  return (
    entries.find((entry) => booleanValue(entry?.IsDefault) === true) ??
    entries[0]
  );
}

function bitrateFromSize(
  sourceSizeBytes: number | undefined,
  sourceDurationSeconds: number | undefined,
) {
  return sourceSizeBytes && sourceDurationSeconds
    ? Math.round((sourceSizeBytes * 8) / sourceDurationSeconds / 1000)
    : undefined;
}

export function createJellyfinExportEstimateMetadata(
  mediaSource: JellyfinMediaSource,
  fallbackDurationSeconds: number,
): PlaybackExportEstimateMetadata | undefined {
  const videoStreams = asArray(mediaSource?.MediaStreams).filter((stream) =>
    isVideoMediaStream(stream),
  );
  const audioStreams = asArray(mediaSource?.MediaStreams).filter((stream) =>
    isAudioMediaStream(stream),
  );
  const selectedVideoStream = firstDefaultOrFirst(videoStreams);
  const selectedAudioStream = firstDefaultOrFirst(audioStreams);
  const sourceSizeBytes = positiveNumber(mediaSource?.Size);
  const sourceDurationSeconds =
    ticksToSeconds(mediaSource?.RunTimeTicks) ||
    (fallbackDurationSeconds > 0 ? fallbackDurationSeconds : undefined);
  const sourceBitrateKbps =
    bpsToKbps(mediaSource?.Bitrate) ??
    bitrateFromSize(sourceSizeBytes, sourceDurationSeconds);
  const videoCodec = normalizeExportVideoCodec(
    stringValue(selectedVideoStream?.Codec),
  );

  const metadata = {
    sourceSizeBytes,
    sourceDurationSeconds,
    sourceBitrateKbps,
    videoBitrateKbps: bpsToKbps(selectedVideoStream?.BitRate),
    audioBitrateKbps: bpsToKbps(selectedAudioStream?.BitRate),
    ...(videoCodec ? { videoCodec } : {}),
    width: positiveNumber(selectedVideoStream?.Width),
    height: positiveNumber(selectedVideoStream?.Height),
    frameRate:
      positiveNumber(selectedVideoStream?.AverageFrameRate) ??
      positiveNumber(selectedVideoStream?.RealFrameRate),
  } satisfies PlaybackExportEstimateMetadata;

  return Object.values(metadata).some((value) => value !== undefined)
    ? metadata
    : undefined;
}

function jellyfinAudioTrackTitle(stream: JellyfinMediaStream) {
  return stringValue(stream?.Title) ?? stringValue(stream?.DisplayTitle);
}

export function selectedJellyfinAudioStreamIndex(
  sessionInfo: JellyfinSessionInfo,
  mediaSource?: JellyfinMediaSource,
) {
  return (
    streamIndexValue(sessionInfo?.PlayState?.AudioStreamIndex) ??
    streamIndexValue(mediaSource?.DefaultAudioStreamIndex)
  );
}

export function deriveSelectedAudioTrack(
  sessionInfo: JellyfinSessionInfo,
  item: JellyfinItem,
  mediaSourceId?: string,
  playbackInfo?: JellyfinPlaybackInfo,
): PlaybackAudioSelection | undefined {
  const mediaSource = currentMediaSource(
    sessionInfo,
    item,
    mediaSourceId,
    playbackInfo,
  );
  if (!mediaSource) {
    return undefined;
  }

  const audioStreams = asArray(mediaSource?.MediaStreams).filter((stream) =>
    isAudioMediaStream(stream),
  );
  if (audioStreams.length === 0) {
    return undefined;
  }

  const selectedAudioStreamIndex = selectedJellyfinAudioStreamIndex(
    sessionInfo,
    mediaSource,
  );

  if (selectedAudioStreamIndex === undefined) {
    if (audioStreams.length !== 1) {
      return undefined;
    }

    const onlyAudioStream = audioStreams[0];
    return {
      trackNumber: 1,
      languageCode: stringValue(onlyAudioStream?.Language),
      title: jellyfinAudioTrackTitle(onlyAudioStream),
    };
  }

  const selectedAudioTrackIndex = audioStreams.findIndex(
    (stream) => numberValue(stream?.Index) === selectedAudioStreamIndex,
  );
  if (selectedAudioTrackIndex === -1) {
    return undefined;
  }

  const selectedAudioStream = audioStreams[selectedAudioTrackIndex];
  return {
    trackNumber: selectedAudioTrackIndex + 1,
    languageCode: stringValue(selectedAudioStream?.Language),
    title: jellyfinAudioTrackTitle(selectedAudioStream),
  };
}

export function buildStaticStreamPath(
  item: JellyfinItem,
  mediaSourceId: string | undefined,
  context: JellyfinSourceContext,
  jellyfinPlaySessionId: string,
) {
  const itemId = stringValue(item?.Id);
  if (!itemId) {
    return;
  }

  const isAudio = normalizedString(item?.MediaType) === "audio";
  const params = new URLSearchParams({
    static: "true",
    deviceId: context.deviceId,
    playSessionId: jellyfinPlaySessionId,
    context: "Static",
  });

  if (mediaSourceId) {
    params.set("mediaSourceId", mediaSourceId);
  }

  return `${isAudio ? `/Audio/${encodeURIComponent(itemId)}/stream` : `/Videos/${encodeURIComponent(itemId)}/stream`}?${params.toString()}`;
}

export function buildPreviewPath(
  item: JellyfinItem,
  mediaSourceId: string | undefined,
  context: JellyfinSourceContext,
  jellyfinPlaySessionId: string,
  audioStreamIndex?: number,
) {
  const itemId = stringValue(item?.Id);
  if (
    !itemId ||
    normalizedString(item?.MediaType) === "audio" ||
    !mediaSourceId
  ) {
    return;
  }

  const params = new URLSearchParams({
    mediaSourceId,
    deviceId: context.deviceId,
    playSessionId: jellyfinPlaySessionId,
    maxAudioChannels: "2",
    audioCodec: "aac",
    videoCodec: "h264",
    videoBitRate: "12000000",
    maxWidth: "1920",
    maxHeight: "1080",
    maxVideoBitDepth: "8",
    allowVideoStreamCopy: "false",
    enableAutoStreamCopy: "false",
    enableAdaptiveBitrateStreaming: "false",
    alwaysBurnInSubtitleWhenTranscoding: "false",
  });

  if (audioStreamIndex !== undefined) {
    params.set("audioStreamIndex", String(audioStreamIndex));
  }

  return `/Videos/${encodeURIComponent(itemId)}/master.m3u8?${params.toString()}`;
}
