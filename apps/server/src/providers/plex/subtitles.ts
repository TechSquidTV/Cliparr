import { createApiError } from "@/http/errors";
import type { ProviderSessionRecord } from "@/session/store";
import type { TranscodeDecisionData } from "@cliparr/plex/pms/types";
import {
  libraryGetStreamsStreamUrl,
  startSelectedSubtitleUrl,
} from "@cliparr/plex/pms/urls";
import { requestSubtitleDecision } from "@/providers/plex/mediaClient";
import type {
  MediaHandle,
  PlaybackSubtitleSelection,
  PlaybackSubtitleTrack,
} from "@/providers/types";
import {
  booleanFlag,
  isTextSubtitleCodec,
  normalizeSubtitleCodec,
  subtitleFileExtension,
} from "@/providers/shared/subtitles";
import { numberValue, stringValue } from "@/providers/shared/utilities";
import { type PlexSourceContext } from "@/providers/plex/shared";
import type {
  PlexMediaSelection,
  PlexMetadataItem,
  PlexStream,
} from "@/providers/plex/selection";
import {
  createCliparrPlexTranscodeSessionId,
  idValue,
  isSelectedEntry,
  isSubtitleStream,
  metadataPath,
  resolveSelectedPart,
  streamEntries,
} from "@/providers/plex/selection";
import { createMediaHandle } from "@/providers/plex/mediaHandles";

function selectedSubtitleTrackTitle(stream: PlexStream) {
  return (
    stringValue(stream?.title) ??
    stringValue(stream?.extendedDisplayTitle) ??
    stringValue(stream?.displayTitle) ??
    stringValue(stream?.language)
  );
}

function directSubtitleResource(stream: PlexStream) {
  const key = stringValue(stream.key);
  const codec = normalizeSubtitleCodec(stream.codec);
  if (!key || !isTextSubtitleCodec(codec)) {
    return;
  }
  const format = codec === "srt" || codec === "subrip" ? "srt" : "vtt";
  const streamId = Number(stream.id);
  const extension = subtitleFileExtension(codec, key);
  if (Number.isSafeInteger(streamId) && extension) {
    const barePath = libraryGetStreamsStreamUrl({
      path: { streamId, ext: "" },
    }).slice(0, -1);
    if (key === barePath || key === `${barePath}.${extension}`) {
      return {
        path: libraryGetStreamsStreamUrl({
          path: { streamId, ext: extension },
          query: format === "vtt" ? { format } : undefined,
        }),
        format,
      };
    }
  }
  // Following a returned resource does not convert its content. Only advertise
  // the raw formats understood by the editor's parser.
  if (["srt", "subrip", "vtt", "webvtt"].includes(codec ?? "")) {
    return { path: key, format };
  }
}

function buildSelectedPlexSubtitleTranscodePath(
  item: PlexMetadataItem,
  subtitleSessionId: string,
  selection: PlexMediaSelection | undefined,
  stream: PlexStream,
) {
  const path = metadataPath(item);
  const codec = normalizeSubtitleCodec(stream?.codec);
  if (!path || !canTranscodeSelectedPlexSubtitle(codec, stream)) {
    return;
  }

  const resolvedSelection = resolveSelectedPart(item, selection);
  const query = {
    path,
    session: subtitleSessionId,
    protocol: "http",
    directPlay: 1,
    hasMDE: 1,
    mediaIndex: resolvedSelection?.mediaIndex ?? 0,
    partIndex: resolvedSelection?.partIndex ?? 0,
    subtitles: "sidecar",
    advancedSubtitles: "text",
    autoAdjustSubtitle: 0,
    offset: 0,
    copyts: 1,
  } satisfies TranscodeDecisionData["query"];
  return { path: startSelectedSubtitleUrl({ query }), query };
}

function canTranscodeSelectedPlexSubtitle(
  codec: string | undefined,
  stream: PlexStream,
) {
  return (
    !stringValue(stream.key) &&
    isSelectedEntry(stream) &&
    isTextSubtitleCodec(codec) &&
    Boolean(idValue(stream.id))
  );
}

function plexSubtitleTrack(
  session: ProviderSessionRecord,
  context: PlexSourceContext,
  item: PlexMetadataItem,
  playbackSessionId: string,
  selection: PlexMediaSelection | undefined,
  stream: PlexStream,
): PlaybackSubtitleTrack {
  const streamId = idValue(stream.id);
  const codec = normalizeSubtitleCodec(stream?.codec);
  const direct = directSubtitleResource(stream);
  const isText = isTextSubtitleCodec(codec);
  const transcodeSubtitleAvailable =
    Boolean(metadataPath(item)) &&
    canTranscodeSelectedPlexSubtitle(codec, stream);
  const subtitleSessionId =
    transcodeSubtitleAvailable && !direct
      ? createCliparrPlexTranscodeSessionId(
          context.sourceId,
          `${session.id}:${playbackSessionId}:subtitles:${streamId}`,
        )
      : undefined;
  const transcodeSubtitlePath = subtitleSessionId
    ? buildSelectedPlexSubtitleTranscodePath(
        item,
        subtitleSessionId,
        selection,
        stream,
      )
    : undefined;
  const contentFormat =
    direct?.format ?? (transcodeSubtitlePath ? "srt" : undefined);
  const contentPath = direct?.path ?? transcodeSubtitlePath?.path;

  return {
    streamId,
    index: numberValue(stream?.index) ?? numberValue(stream?.streamIdentifier),
    languageCode:
      stringValue(stream?.languageCode) ?? stringValue(stream?.languageTag),
    title: selectedSubtitleTrackTitle(stream),
    codec,
    contentFormat,
    isText,
    isDefault: booleanFlag(stream?.default),
    isForced: booleanFlag(stream?.forced),
    isHearingImpaired: booleanFlag(stream?.hearingImpaired),
    isExternal: Boolean(stringValue(stream?.key)),
    contentUrl: contentPath
      ? createMediaHandle(session, context, contentPath, {
          playbackSessionId: transcodeSubtitlePath
            ? subtitleSessionId
            : undefined,
          subtitleStreamId: transcodeSubtitlePath ? streamId : undefined,
          subtitleDecision: transcodeSubtitlePath?.query,
        })
      : undefined,
  };
}

export function deriveSubtitleTracks(
  session: ProviderSessionRecord,
  context: PlexSourceContext,
  item: PlexMetadataItem,
  playbackSessionId: string,
  selection?: PlexMediaSelection,
) {
  const resolvedPart = resolveSelectedPart(item, selection);
  const part = resolvedPart?.part;
  if (!part) {
    return [];
  }

  return streamEntries(part)
    .filter((stream) => isSubtitleStream(stream))
    .map((stream) =>
      plexSubtitleTrack(
        session,
        context,
        item,
        playbackSessionId,
        selection,
        stream,
      ),
    );
}

export function deriveSelectedSubtitleTrack(
  item: PlexMetadataItem,
  selection?: PlexMediaSelection,
): PlaybackSubtitleSelection | undefined {
  const part = resolveSelectedPart(item, selection)?.part;
  if (!part) {
    return undefined;
  }

  const selectedSubtitleStream = streamEntries(part)
    .filter((stream) => isSubtitleStream(stream))
    .find((stream) => isSelectedEntry(stream));
  if (!selectedSubtitleStream) {
    return undefined;
  }

  const codec = normalizeSubtitleCodec(selectedSubtitleStream?.codec);
  const direct = directSubtitleResource(selectedSubtitleStream);
  const transcodeSubtitleAvailable =
    Boolean(metadataPath(item)) &&
    canTranscodeSelectedPlexSubtitle(codec, selectedSubtitleStream);

  return {
    streamId: idValue(selectedSubtitleStream?.id),
    index:
      numberValue(selectedSubtitleStream?.index) ??
      numberValue(selectedSubtitleStream?.streamIdentifier),
    languageCode:
      stringValue(selectedSubtitleStream?.languageCode) ??
      stringValue(selectedSubtitleStream?.languageTag),
    title: selectedSubtitleTrackTitle(selectedSubtitleStream),
    codec,
    contentFormat:
      direct?.format ?? (transcodeSubtitleAvailable ? "srt" : undefined),
    isText: isTextSubtitleCodec(codec),
  };
}

export function subtitleTrackSupportsBurnIn(track: PlaybackSubtitleTrack) {
  return Boolean(track.isText && track.contentUrl);
}

export async function preparePlexSubtitleTranscode(
  handle: MediaHandle,
  headers: Headers,
  subtitleStreamId: string,
  signal: AbortSignal,
) {
  const query = handle.providerMetadata?.plex?.subtitleDecision;
  if (!query) {
    throw createApiError(
      400,
      "plex_subtitle_decision_missing",
      "Subtitle handle has no playback decision contract",
    );
  }
  const decisionHeaders = new Headers(headers);
  decisionHeaders.set("Accept", "application/json");
  decisionHeaders.delete("Range");
  const decision = await requestSubtitleDecision(
    handle,
    query,
    decisionHeaders,
    signal,
  );
  const container = decision?.MediaContainer;
  const decisionCode = numberValue(
    container?.mdeDecisionCode ?? container?.generalDecisionCode,
  );
  if (!container || (decisionCode !== undefined && decisionCode >= 2000)) {
    throw createApiError(
      502,
      "plex_subtitle_decision_failed",
      "Plex could not prepare the embedded subtitle track.",
    );
  }
  const decisionItem = container.Metadata?.[0];
  const selectedTrack = decisionItem
    ? deriveSelectedSubtitleTrack(decisionItem)
    : undefined;
  if (selectedTrack?.streamId !== subtitleStreamId) {
    throw createApiError(
      409,
      "plex_subtitle_selection_changed",
      "The selected Plex subtitle changed. Refresh the editor and try again.",
    );
  }
}
