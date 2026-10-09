import type { ProviderSessionRecord } from "@/session/store";
import type {
  PlaybackSubtitleSelection,
  PlaybackSubtitleTrack,
} from "@/providers/types";
import {
  isTextSubtitleCodec,
  normalizeSubtitleCodec,
  subtitleContentFormat,
} from "@/providers/shared/subtitles";
import {
  asArray,
  numberValue,
  stringValue,
} from "@/providers/shared/utilities";
import {
  booleanValue,
  type JellyfinItem,
  type JellyfinMediaStream,
  type JellyfinPlaybackInfo,
  type JellyfinSessionInfo,
  type JellyfinSourceContext,
} from "@/providers/jellyfin/shared";
import { createMediaHandle } from "@/providers/jellyfin/mediaProxy";
import {
  currentMediaSource,
  isSubtitleMediaStream,
} from "@/providers/jellyfin/selection";

function jellyfinSubtitleTrackTitle(stream: JellyfinMediaStream) {
  return (
    stringValue(stream?.Title) ??
    stringValue(stream?.DisplayTitle) ??
    stringValue(stream?.Language)
  );
}

function buildJellyfinSubtitlePath(
  itemId: string | undefined,
  mediaSourceId: string | undefined,
  subtitleIndex: number | undefined,
  contentFormat: string | undefined,
) {
  if (
    !itemId ||
    !mediaSourceId ||
    subtitleIndex === undefined ||
    !contentFormat
  ) {
    return;
  }

  return `/Videos/${encodeURIComponent(itemId)}/${encodeURIComponent(mediaSourceId)}/Subtitles/${subtitleIndex}/Stream.${encodeURIComponent(contentFormat)}`;
}

function jellyfinSubtitleTrack(
  session: ProviderSessionRecord,
  context: JellyfinSourceContext,
  itemId: string | undefined,
  mediaSourceId: string | undefined,
  stream: JellyfinMediaStream,
): PlaybackSubtitleTrack {
  const codec = normalizeSubtitleCodec(stream?.Codec);
  const isText =
    booleanValue(stream?.IsTextSubtitleStream) ?? isTextSubtitleCodec(codec);
  const contentFormat = isText
    ? (subtitleContentFormat(codec) ?? "vtt")
    : undefined;
  const subtitleIndex = numberValue(stream?.Index);
  const subtitlePath = buildJellyfinSubtitlePath(
    itemId,
    mediaSourceId,
    subtitleIndex,
    contentFormat,
  );

  return {
    streamId: subtitleIndex === undefined ? undefined : String(subtitleIndex),
    index: subtitleIndex,
    languageCode: stringValue(stream?.Language),
    title: jellyfinSubtitleTrackTitle(stream),
    codec,
    contentFormat,
    isText,
    isDefault: booleanValue(stream?.IsDefault),
    isForced: booleanValue(stream?.IsForced),
    isHearingImpaired: booleanValue(stream?.IsHearingImpaired),
    isExternal: booleanValue(stream?.IsExternal),
    contentUrl: subtitlePath
      ? createMediaHandle(session, context, subtitlePath)
      : undefined,
  };
}

export function deriveSubtitleTracks(
  session: ProviderSessionRecord,
  context: JellyfinSourceContext,
  item: JellyfinItem,
  mediaSourceId?: string,
  sessionInfo?: JellyfinSessionInfo,
  playbackInfo?: JellyfinPlaybackInfo,
) {
  const mediaSource = currentMediaSource(
    sessionInfo,
    item,
    mediaSourceId,
    playbackInfo,
  );
  if (!mediaSource) {
    return [];
  }

  const itemId = stringValue(item?.Id);
  const resolvedMediaSourceId = stringValue(mediaSource?.Id) ?? mediaSourceId;

  return asArray(mediaSource?.MediaStreams)
    .filter((stream) => isSubtitleMediaStream(stream))
    .map((stream) =>
      jellyfinSubtitleTrack(
        session,
        context,
        itemId,
        resolvedMediaSourceId,
        stream,
      ),
    );
}

export function deriveSelectedSubtitleTrack(
  sessionInfo: JellyfinSessionInfo,
  item: JellyfinItem,
  mediaSourceId: string | undefined,
  playbackInfo?: JellyfinPlaybackInfo,
): PlaybackSubtitleSelection | undefined {
  const mediaSource = currentMediaSource(
    sessionInfo,
    item,
    mediaSourceId,
    playbackInfo,
  );
  if (!mediaSource) {
    return undefined;
  }

  const subtitleStreams = asArray(mediaSource?.MediaStreams).filter((stream) =>
    isSubtitleMediaStream(stream),
  );
  if (subtitleStreams.length === 0) {
    return undefined;
  }

  const selectedSubtitleStreamIndex =
    numberValue(sessionInfo?.PlayState?.SubtitleStreamIndex) ??
    numberValue(mediaSource?.DefaultSubtitleStreamIndex);
  if (selectedSubtitleStreamIndex === undefined) {
    return undefined;
  }

  const selectedSubtitleStream = subtitleStreams.find(
    (stream) => numberValue(stream?.Index) === selectedSubtitleStreamIndex,
  );
  if (!selectedSubtitleStream) {
    return undefined;
  }

  const codec = normalizeSubtitleCodec(selectedSubtitleStream?.Codec);
  const isText =
    booleanValue(selectedSubtitleStream?.IsTextSubtitleStream) ??
    isTextSubtitleCodec(codec);

  return {
    streamId: String(selectedSubtitleStreamIndex),
    index: selectedSubtitleStreamIndex,
    languageCode: stringValue(selectedSubtitleStream?.Language),
    title: jellyfinSubtitleTrackTitle(selectedSubtitleStream),
    codec,
    contentFormat: isText ? (subtitleContentFormat(codec) ?? "vtt") : undefined,
    isText,
  };
}
