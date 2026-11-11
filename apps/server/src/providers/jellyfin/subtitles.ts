import { createMediaHandle } from "@/providers/jellyfin/mediaProxy";
import {
  buildSubtitleStreamPath,
  isSubtitleMediaStream,
} from "@/providers/jellyfin/selection";
import type {
  JellyfinMediaSource,
  JellyfinMediaStream,
  JellyfinSourceContext,
} from "@/providers/jellyfin/shared";
import {
  isTextSubtitleCodec,
  normalizeSubtitleCodec,
  subtitleContentFormat,
} from "@/providers/shared/subtitles";
import {
  asArray,
  booleanValue,
  numberValue,
  stringValue,
} from "@/providers/shared/utilities";
import type {
  PlaybackSubtitleSelection,
  PlaybackSubtitleTrack,
} from "@/providers/types";
import type { ProviderSessionRecord } from "@/session/store";

function jellyfinSubtitleTrackTitle(stream: JellyfinMediaStream) {
  return (
    stringValue(stream?.Title) ??
    stringValue(stream?.DisplayTitle) ??
    stringValue(stream?.Language)
  );
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
  const subtitleIndex = numberValue(stream?.Index ?? undefined);
  const subtitlePath = buildSubtitleStreamPath(
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
      ? createMediaHandle(session, context, subtitlePath, { kind: "subtitle" })
      : undefined,
  };
}

export function deriveSubtitleTracks(
  session: ProviderSessionRecord,
  context: JellyfinSourceContext,
  itemId: string | undefined,
  mediaSource: JellyfinMediaSource | undefined,
  fallbackMediaSourceId?: string,
) {
  const resolvedMediaSourceId =
    stringValue(mediaSource?.Id) ?? fallbackMediaSourceId;

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
  tracks: readonly PlaybackSubtitleTrack[],
  index: number | undefined,
): PlaybackSubtitleSelection | undefined {
  if (index === undefined || index < 0) {
    return;
  }
  const track = tracks.find((entry) => entry.index === index);
  if (!track) {
    return;
  }
  return {
    streamId: track.streamId,
    index: track.index,
    languageCode: track.languageCode,
    title: track.title,
    codec: track.codec,
    contentFormat: track.contentFormat,
    isText: track.isText,
  };
}
