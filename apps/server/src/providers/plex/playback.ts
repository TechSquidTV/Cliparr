import { createHash, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import {
  logErrorFields,
  logEventFields,
  sanitizeUrlForLog,
} from "@cliparr/shared/logging";
import {
  updateMediaSource,
  type MediaSource,
} from "@/db/mediaSourcesRepository";
import { createApiError, isApiError } from "@/http/errors";
import { getServerLogger } from "@/logging";
import type { ProviderSessionRecord } from "@/session/store";
import type {
  CurrentlyPlayingEntry,
  MediaExportMetadata,
  PlaybackAudioSelection,
  PlaybackExportEstimateMetadata,
  PlaybackSubtitleSelection,
  PlaybackSubtitleTrack,
  ProviderConnection,
  ProviderResource,
} from "@/providers/types";
import {
  createProviderMediaHandle,
  fetchMediaHandleRequest,
  mediaHandleRequestUrl,
  proxyProviderMediaResponse,
  sanitizeLoggedMediaPath,
  shouldAttachProviderAuth,
  shouldForwardMediaRange,
} from "@/providers/shared/mediaProxy";
import {
  booleanFlag,
  isTextSubtitleCodec,
  normalizeSubtitleCodec,
  subtitleContentFormat,
  subtitleFileExtension,
} from "@/providers/shared/subtitles";
import {
  asArray,
  buildEpisodeSourceTitle,
  errorMessage,
  numberValue,
  stringValue,
  uniqueStrings,
} from "@/providers/shared/utilities";
import {
  buildSourceContext,
  candidateConnections,
  CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
  fetchPmsCurrentSessions,
  fetchPmsMetadata,
  plexMediaHeaders,
  sourceResource,
  unreachableConnectionMessage,
  type PlexSourceContext,
} from "@/providers/plex/shared";
import {
  PLEX_BASE_URL_MODE_AUTO,
  PLEX_BASE_URL_MODE_MANUAL,
  type PlexBaseUrlMode,
  withPlexBaseUrlMode,
} from "@/providers/plex/connectionState";

const logger = getServerLogger(["provider", "plex", "playback"]);
const HD_ARTWORK_SIZE = 1920;
const PLEX_METADATA_PATH_PREFIX = "/library/metadata/";

function createMediaHandle(
  session: ProviderSessionRecord,
  context: PlexSourceContext,
  path: string,
  options: { basePath?: string; playbackSessionId?: string } = {},
) {
  return createProviderMediaHandle(
    session,
    {
      providerId: "plex",
      sourceId: context.sourceId,
      baseUrl: context.baseUrl,
      token: context.token,
      providerMetadata:
        options.playbackSessionId === undefined
          ? undefined
          : {
              plex: {
                playbackSessionId: options.playbackSessionId,
              },
            },
    },
    path,
    {
      basePath: options.basePath,
    },
  );
}

type PlexIdValue = string | number | null | undefined;
type PlexViewOffsetValue = number | string | null | undefined;
type PlexSelectionValue = boolean | number | string | null | undefined;
type PlexTagInput =
  | string
  | PlexTag
  | Array<string | PlexTag>
  | null
  | undefined;

interface PlexMetadataPathItem {
  ratingKey?: PlexIdValue;
  key?: string | null;
}

interface PlexSelectableEntry {
  selected?: PlexSelectionValue;
}

interface PlexTag {
  id?: PlexIdValue;
  ratingKey?: PlexIdValue;
  tag?: unknown;
}

interface PlexNetworkTag {
  tag?: unknown;
  title?: unknown;
}

interface PlexStream extends PlexSelectableEntry {
  bitrate?: unknown;
  codec?: unknown;
  default?: PlexSelectionValue;
  displayTitle?: unknown;
  extendedDisplayTitle?: unknown;
  frameRate?: unknown;
  forced?: PlexSelectionValue;
  height?: unknown;
  hearingImpaired?: PlexSelectionValue;
  id?: PlexIdValue;
  index?: PlexIdValue;
  key?: unknown;
  language?: unknown;
  languageCode?: unknown;
  languageTag?: unknown;
  streamIdentifier?: PlexIdValue;
  streamType?: PlexIdValue;
  title?: unknown;
  width?: unknown;
}

interface PlexPart extends PlexSelectableEntry {
  Stream?: PlexStream | PlexStream[] | null;
  createdAt?: PlexIdValue;
  duration?: PlexViewOffsetValue;
  file?: unknown;
  id?: PlexIdValue;
  key?: unknown;
  size?: unknown;
  updatedAt?: PlexIdValue;
}

interface PlexMedia extends PlexSelectableEntry {
  Part?: PlexPart | PlexPart[] | null;
  bitrate?: unknown;
  duration?: PlexViewOffsetValue;
  height?: unknown;
  id?: PlexIdValue;
  width?: unknown;
}

interface PlexPlaybackUser {
  id?: PlexIdValue;
  thumb?: string | null;
  title?: string | null;
}

interface PlexPlaybackPlayer {
  machineIdentifier?: string | null;
  state?: string | null;
  title?: string | null;
}

interface PlexPlaybackSession {
  id?: PlexIdValue;
}

interface PlexMetadataItem extends PlexMetadataPathItem {
  Director?: PlexTag | PlexTag[] | null;
  Genre?: PlexTag | PlexTag[] | null;
  Guid?: PlexTag | PlexTag[] | null;
  Media?: PlexMedia | PlexMedia[] | null;
  Network?: PlexNetworkTag | null;
  Player?: PlexPlaybackPlayer | null;
  Role?: PlexTag | PlexTag[] | null;
  Session?: PlexPlaybackSession | null;
  User?: PlexPlaybackUser | null;
  Writer?: PlexTag | PlexTag[] | null;
  contentRating?: unknown;
  duration?: PlexViewOffsetValue;
  grandparentThumb?: unknown;
  grandparentTitle?: unknown;
  guid?: unknown;
  index?: unknown;
  originallyAvailableAt?: unknown;
  parentIndex?: unknown;
  parentThumb?: unknown;
  parentTitle?: unknown;
  sessionKey?: PlexIdValue;
  studio?: unknown;
  summary?: unknown;
  tagline?: unknown;
  thumb?: unknown;
  title?: unknown;
  type?: unknown;
  viewOffset?: PlexViewOffsetValue;
  year?: unknown;
}

interface PlexCurrentlyPlayingData {
  MediaContainer?: {
    Metadata?: PlexMetadataItem[] | null;
  } | null;
}

interface PlexMetadataData {
  MediaContainer?: {
    Metadata?: PlexMetadataItem[] | null;
  } | null;
}

function metadataPath(item: PlexMetadataPathItem | null | undefined) {
  const ratingKey = idValue(item?.ratingKey);
  if (ratingKey) {
    return `${PLEX_METADATA_PATH_PREFIX}${ratingKey}`;
  }
  if (
    typeof item?.key === "string" &&
    item.key.startsWith(PLEX_METADATA_PATH_PREFIX)
  ) {
    return item.key;
  }
  return;
}

function metadataId(item: PlexMetadataPathItem | null | undefined) {
  const ratingKey = idValue(item?.ratingKey);
  if (ratingKey) {
    return ratingKey;
  }

  const path = metadataPath(item);
  if (!path) {
    return;
  }

  const parsed = new URL(path, "http://cliparr.local");
  const id = parsed.pathname
    .slice(PLEX_METADATA_PATH_PREFIX.length)
    .split("/")[0];
  return idValue(id);
}

interface PlexMediaSelection {
  mediaId?: string;
  mediaIndex?: number;
  partId?: string;
  partIndex?: number;
}

function idValue(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  return;
}

function itemTypeValue(item: PlexMetadataItem) {
  return stringValue(item.type)?.toLowerCase() ?? "";
}

function itemTitleValue(item: PlexMetadataItem) {
  return stringValue(item.title) ?? "Untitled";
}

function isSelectedEntry(entry: PlexSelectableEntry | undefined) {
  return (
    entry?.selected === true || entry?.selected === 1 || entry?.selected === "1"
  );
}

function mediaEntries(item: PlexMetadataItem | undefined) {
  return asArray(item?.Media);
}

function partEntries(media: PlexMedia | undefined) {
  return asArray(media?.Part);
}

function streamEntries(part: PlexPart | undefined) {
  return asArray(part?.Stream);
}

function selectedIndex<T extends PlexSelectableEntry>(entries: T[]) {
  const index = entries.findIndex((entry) => isSelectedEntry(entry));
  return Math.max(index, 0);
}

export function playheadSecondsFromViewOffset(value?: PlexViewOffsetValue) {
  if (value === null || value === undefined) {
    return;
  }

  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return;
  }

  return milliseconds / 1000;
}

function deriveMediaSelection(
  item: PlexMetadataItem,
): PlexMediaSelection | undefined {
  const media = mediaEntries(item);
  if (media.length === 0) {
    return undefined;
  }

  const mediaIndex = selectedIndex(media);
  const selectedMedia = media[mediaIndex];
  const parts = partEntries(selectedMedia);
  const partIndex = parts.length > 0 ? selectedIndex(parts) : undefined;
  const selectedPart = partIndex === undefined ? undefined : parts[partIndex];

  return {
    mediaId: idValue(selectedMedia?.id),
    mediaIndex,
    partId: idValue(selectedPart?.id),
    partIndex,
  };
}

function resolveSelectedPart(
  item: PlexMetadataItem | undefined,
  selection?: PlexMediaSelection,
) {
  const media = mediaEntries(item);
  if (media.length === 0) {
    return;
  }

  let mediaIndex = selection?.mediaId
    ? media.findIndex((entry) => idValue(entry?.id) === selection.mediaId)
    : -1;
  if (
    mediaIndex < 0 &&
    selection?.mediaIndex !== undefined &&
    media[selection.mediaIndex]
  ) {
    mediaIndex = selection.mediaIndex;
  }
  if (mediaIndex < 0) {
    mediaIndex = selectedIndex(media);
  }

  const selectedMedia = media[mediaIndex];
  const parts = partEntries(selectedMedia);
  if (parts.length === 0) {
    return {
      media: selectedMedia,
      mediaIndex,
      part: undefined,
      partIndex: 0,
    };
  }

  let partIndex = selection?.partId
    ? parts.findIndex((entry) => idValue(entry?.id) === selection.partId)
    : -1;
  if (
    partIndex < 0 &&
    selection?.partIndex !== undefined &&
    parts[selection.partIndex]
  ) {
    partIndex = selection.partIndex;
  }
  if (partIndex < 0) {
    partIndex = selectedIndex(parts);
  }

  return {
    media: selectedMedia,
    mediaIndex,
    part: parts[partIndex],
    partIndex,
  };
}

export function createPreviewPath(
  item: PlexMetadataItem,
  transcodeSessionId: string,
  selection?: PlexMediaSelection,
) {
  if (itemTypeValue(item) === "track") {
    return;
  }

  const path = metadataPath(item);
  if (!path) {
    return;
  }

  const resolvedSelection = resolveSelectedPart(item, selection);
  const params = new URLSearchParams({
    path,
    transcodeSessionId,
    protocol: "hls",
    directPlay: "0",
    directStream: "0",
    directStreamAudio: "0",
    subtitles: "none",
    mediaIndex: String(resolvedSelection?.mediaIndex ?? 0),
    partIndex: String(resolvedSelection?.partIndex ?? 0),
    audioChannelCount: "2",
    videoQuality: "80",
    videoResolution: "1920x1080",
    videoBitrate: "12000",
    peakBitrate: "12000",
    location: "lan",
    mediaBufferSize: "102400",
  });

  return `/video/:/transcode/universal/start.m3u8?${params.toString()}`;
}

export function createCliparrPlexTranscodeSessionId(
  sourceId: string,
  playbackSessionId: string,
) {
  const digest = createHash("sha256")
    .update(`${sourceId}:${playbackSessionId}`)
    .digest("hex")
    .slice(0, 32);
  const version = "5";
  const variant = ((Number.parseInt(digest[16] ?? "0", 16) & 0x3) | 0x8)
    .toString(16)
    .slice(0, 1);

  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `${version}${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

function transcodeSessionId(path: string) {
  try {
    return new URL(path, "http://cliparr.local").searchParams.get(
      "transcodeSessionId",
    );
  } catch {
    return null;
  }
}

function isRetryableConnectionError(error: unknown) {
  if (!isApiError(error)) {
    return true;
  }

  return (
    error.code === "plex_request_failed" &&
    error.status !== 401 &&
    error.status !== 403
  );
}

function persistWorkingSourceConnection(
  source: MediaSource,
  connections: ProviderResource["connections"],
  connection: ProviderConnection,
  options: { baseUrlMode: PlexBaseUrlMode; manualConnectionId?: string },
) {
  if (options.baseUrlMode === PLEX_BASE_URL_MODE_MANUAL) {
    if (connection.id === options.manualConnectionId) {
      return;
    }

    if (stringValue(source.connection.selectedConnectionId) === connection.id) {
      return;
    }

    updateMediaSource(source.id, {
      connection: {
        ...withPlexBaseUrlMode(source.connection, PLEX_BASE_URL_MODE_MANUAL),
        connections,
        selectedConnectionId: connection.id,
      },
    });
    return;
  }

  if (
    source.baseUrl === connection.uri &&
    stringValue(source.connection.selectedConnectionId) === connection.id
  ) {
    return;
  }

  updateMediaSource(source.id, {
    baseUrl: connection.uri,
    connection: {
      ...withPlexBaseUrlMode(source.connection, PLEX_BASE_URL_MODE_AUTO),
      connections,
      selectedConnectionId: connection.id,
    },
  });
}

async function fetchCurrentlyPlayingData(source: MediaSource) {
  const {
    baseUrlMode,
    manualConnectionId,
    persistedConnections,
    preferredConnectionId,
    resource,
  } = sourceResource(source);
  const failures: string[] = [];

  for (const connection of candidateConnections(
    resource,
    preferredConnectionId,
    baseUrlMode,
  )) {
    const context = buildSourceContext(
      source.id,
      resource.accessToken,
      connection,
    );

    try {
      const data = (await fetchPmsCurrentSessions(context, {
        timeoutMs: CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
      })) as PlexCurrentlyPlayingData;
      persistWorkingSourceConnection(source, persistedConnections, connection, {
        baseUrlMode,
        manualConnectionId,
      });
      return { context, data };
    } catch (error) {
      if (!isRetryableConnectionError(error)) {
        throw error;
      }

      failures.push(`${connection.uri}: ${errorMessage(error)}`);
    }
  }

  throw createApiError(
    502,
    "plex_unreachable",
    unreachableConnectionMessage(resource, failures, baseUrlMode),
  );
}

function playbackFallbackIdentity(item: PlexMetadataItem) {
  const userId = idValue(item?.User?.id);
  const playerId =
    stringValue(item?.Player?.machineIdentifier) ??
    stringValue(item?.Player?.title);
  const itemId =
    idValue(item?.ratingKey) ?? stringValue(item?.key) ?? metadataPath(item);
  const parts = [userId, playerId, itemId].filter(Boolean);

  return parts.length > 0 ? parts.join(":") : undefined;
}

function playbackDeduplicationKey(item: PlexMetadataItem) {
  const sessionKey = idValue(item?.sessionKey);
  if (sessionKey) {
    return `session:${sessionKey}`;
  }

  const sessionId = idValue(item?.Session?.id);
  if (sessionId) {
    return `session-id:${sessionId}`;
  }

  const fallbackIdentity = playbackFallbackIdentity(item);
  if (fallbackIdentity) {
    return `fallback:${fallbackIdentity}`;
  }

  return;
}

function dedupeCurrentlyPlayingMetadata(metadata: PlexMetadataItem[]) {
  // Plex can emit duplicate rows for one live session, especially from web clients.
  const seen = new Set<string>();

  return metadata.filter((item) => {
    const dedupeKey = playbackDeduplicationKey(item);
    if (!dedupeKey) {
      return true;
    }

    if (seen.has(dedupeKey)) {
      return false;
    }

    seen.add(dedupeKey);
    return true;
  });
}

function tagValues(value: PlexTagInput) {
  return uniqueStrings(
    asArray(value).map((entry) => {
      if (typeof entry === "string") {
        return stringValue(entry);
      }

      return (
        stringValue(entry?.tag) ??
        stringValue(entry?.id) ??
        stringValue(entry?.ratingKey)
      );
    }),
  );
}

function metadataImagePath(item: PlexMetadataItem) {
  const type = itemTypeValue(item);
  if (type === "episode") {
    return (
      stringValue(item.grandparentThumb) ??
      stringValue(item.parentThumb) ??
      stringValue(item.thumb)
    );
  }

  if (type === "track") {
    return (
      stringValue(item?.thumb) ??
      stringValue(item?.parentThumb) ??
      stringValue(item?.grandparentThumb)
    );
  }

  return (
    stringValue(item?.thumb) ??
    stringValue(item?.grandparentThumb) ??
    stringValue(item?.parentThumb)
  );
}

function appendPlexTokenToImagePath(path: string, token: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}X-Plex-Token=${encodeURIComponent(token)}`;
}

function metadataHdImagePath(
  item: PlexMetadataItem,
  context: PlexSourceContext,
) {
  const imagePath = metadataImagePath(item);
  if (!imagePath) {
    return;
  }

  const params = new URLSearchParams({
    url: appendPlexTokenToImagePath(imagePath, context.token),
    width: String(HD_ARTWORK_SIZE),
    height: String(HD_ARTWORK_SIZE),
    quality: "-1",
    upscale: "0",
  });

  return `/photo/:/transcode?${params.toString()}`;
}

function buildSourceTitle(item: PlexMetadataItem) {
  const title = stringValue(item?.title);
  if (itemTypeValue(item) !== "episode") {
    return title;
  }

  return (
    buildEpisodeSourceTitle({
      title,
      seriesTitle: stringValue(item.grandparentTitle),
      seasonNumber: numberValue(item.parentIndex),
      episodeNumber: numberValue(item.index),
    }) ?? title
  );
}

function isAudioStream(stream: PlexStream) {
  return numberValue(stream?.streamType) === 2;
}

function isVideoStream(stream: PlexStream) {
  return numberValue(stream?.streamType) === 1;
}

function isSubtitleStream(stream: PlexStream) {
  return numberValue(stream?.streamType) === 3;
}

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function millisecondsToSeconds(value: unknown) {
  const milliseconds = positiveNumber(value);
  return milliseconds === undefined ? undefined : milliseconds / 1000;
}

function firstSelectedOrFirst<T extends PlexSelectableEntry>(
  entries: readonly T[],
) {
  return entries.find((entry) => isSelectedEntry(entry)) ?? entries[0];
}

function bitrateFromSize(
  sourceSizeBytes: number | undefined,
  sourceDurationSeconds: number | undefined,
) {
  return sourceSizeBytes && sourceDurationSeconds
    ? Math.round((sourceSizeBytes * 8) / sourceDurationSeconds / 1000)
    : undefined;
}

export function createPlexExportEstimateMetadata(
  item: PlexMetadataItem,
  selection: PlexMediaSelection | undefined,
  fallbackDurationSeconds: number,
): PlaybackExportEstimateMetadata | undefined {
  const resolvedPart = resolveSelectedPart(item, selection);
  const selectedMedia = resolvedPart?.media;
  const selectedPart = resolvedPart?.part;
  const streams = streamEntries(selectedPart);
  const selectedVideoStream = firstSelectedOrFirst(
    streams.filter((stream) => isVideoStream(stream)),
  );
  const selectedAudioStream = firstSelectedOrFirst(
    streams.filter((stream) => isAudioStream(stream)),
  );
  const sourceSizeBytes = positiveNumber(selectedPart?.size);
  const sourceDurationSeconds =
    millisecondsToSeconds(selectedPart?.duration) ??
    millisecondsToSeconds(selectedMedia?.duration) ??
    (fallbackDurationSeconds > 0 ? fallbackDurationSeconds : undefined);
  const sourceBitrateKbps =
    positiveNumber(selectedMedia?.bitrate) ??
    bitrateFromSize(sourceSizeBytes, sourceDurationSeconds);

  const metadata = {
    sourceSizeBytes,
    sourceDurationSeconds,
    sourceBitrateKbps,
    videoBitrateKbps: positiveNumber(selectedVideoStream?.bitrate),
    audioBitrateKbps: positiveNumber(selectedAudioStream?.bitrate),
    width:
      positiveNumber(selectedVideoStream?.width) ??
      positiveNumber(selectedMedia?.width),
    height:
      positiveNumber(selectedVideoStream?.height) ??
      positiveNumber(selectedMedia?.height),
    frameRate: positiveNumber(selectedVideoStream?.frameRate),
  } satisfies PlaybackExportEstimateMetadata;

  return Object.values(metadata).some((value) => value !== undefined)
    ? metadata
    : undefined;
}

function selectedAudioTrackTitle(stream: PlexStream) {
  return (
    stringValue(stream?.title) ??
    stringValue(stream?.extendedDisplayTitle) ??
    stringValue(stream?.displayTitle)
  );
}

function selectedSubtitleTrackTitle(stream: PlexStream) {
  return (
    stringValue(stream?.title) ??
    stringValue(stream?.extendedDisplayTitle) ??
    stringValue(stream?.displayTitle) ??
    stringValue(stream?.language)
  );
}

function deriveSelectedAudioTrack(
  item: PlexMetadataItem,
  selection?: PlexMediaSelection,
): PlaybackAudioSelection | undefined {
  const part = resolveSelectedPart(item, selection)?.part;
  if (!part) {
    return undefined;
  }

  const audioStreams = streamEntries(part).filter((stream) =>
    isAudioStream(stream),
  );
  if (audioStreams.length === 0) {
    return undefined;
  }

  const selectedAudioIndex = audioStreams.findIndex((stream) =>
    isSelectedEntry(stream),
  );
  if (selectedAudioIndex === -1 && audioStreams.length > 1) {
    return undefined;
  }

  const trackIndex = Math.max(selectedAudioIndex, 0);
  const selectedAudioStream = audioStreams[trackIndex];

  return {
    trackNumber: trackIndex + 1,
    languageCode:
      stringValue(selectedAudioStream?.languageCode) ??
      stringValue(selectedAudioStream?.languageTag),
    title: selectedAudioTrackTitle(selectedAudioStream),
  };
}

function buildPlexSubtitlePath(stream: PlexStream) {
  const key = stringValue(stream?.key);
  const codec = normalizeSubtitleCodec(stream?.codec);
  const directContentFormat = plexDirectSubtitleContentFormat(codec);
  if (!directContentFormat || !key) {
    return;
  }

  const extension = subtitleFileExtension(codec, key);
  if (!extension) {
    return;
  }

  const relative = new URL(key, "http://cliparr.local");

  if (!relative.pathname.endsWith(`.${extension}`)) {
    relative.pathname = `${relative.pathname}.${extension}`;
  }

  if (directContentFormat === "vtt") {
    relative.searchParams.set("format", directContentFormat);
  }

  return `${relative.pathname}${relative.search}`;
}

function plexDirectSubtitleContentFormat(codec: unknown) {
  const normalized = normalizeSubtitleCodec(codec);
  if (normalized === "srt" || normalized === "subrip") {
    return "srt";
  }

  return subtitleContentFormat(codec);
}

function buildSelectedPlexSubtitleTranscodePath(
  item: PlexMetadataItem,
  playbackSessionId: string,
  selection: PlexMediaSelection | undefined,
  stream: PlexStream,
) {
  const path = metadataPath(item);
  const codec = normalizeSubtitleCodec(stream?.codec);
  if (!path || !canTranscodeSelectedPlexSubtitle(codec, stream)) {
    return;
  }

  const resolvedSelection = resolveSelectedPart(item, selection);
  const params = new URLSearchParams({
    path,
    transcodeSessionId: playbackSessionId,
    mediaIndex: String(resolvedSelection?.mediaIndex ?? 0),
    partIndex: String(resolvedSelection?.partIndex ?? 0),
    subtitles: "sidecar",
    advancedSubtitles: "text",
    autoAdjustSubtitle: "0",
  });

  return `/video/:/transcode/universal/subtitles?${params.toString()}`;
}

function canTranscodeSelectedPlexSubtitle(codec: unknown, stream: PlexStream) {
  return isSelectedEntry(stream) && isTextSubtitleCodec(codec);
}

function plexSubtitleContentFormat(
  codec: unknown,
  directSubtitlePath: string | undefined,
  transcodeSubtitleAvailable: boolean,
) {
  if (directSubtitlePath) {
    return plexDirectSubtitleContentFormat(codec);
  }

  if (transcodeSubtitleAvailable) {
    return "srt";
  }

  return subtitleContentFormat(codec);
}

function plexSubtitleTrack(
  session: ProviderSessionRecord,
  context: PlexSourceContext,
  item: PlexMetadataItem,
  playbackSessionId: string,
  selection: PlexMediaSelection | undefined,
  stream: PlexStream,
): PlaybackSubtitleTrack {
  const codec = normalizeSubtitleCodec(stream?.codec);
  const directSubtitlePath = buildPlexSubtitlePath(stream);
  const isText = isTextSubtitleCodec(codec);
  const transcodeSubtitleAvailable =
    Boolean(metadataPath(item)) &&
    canTranscodeSelectedPlexSubtitle(codec, stream);
  const transcodeSubtitlePath = directSubtitlePath
    ? undefined
    : buildSelectedPlexSubtitleTranscodePath(
        item,
        playbackSessionId,
        selection,
        stream,
      );
  const contentFormat = plexSubtitleContentFormat(
    codec,
    directSubtitlePath,
    transcodeSubtitleAvailable,
  );
  const contentPath = directSubtitlePath ?? transcodeSubtitlePath;

  return {
    streamId: idValue(stream?.id),
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
            ? playbackSessionId
            : undefined,
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
  const directSubtitlePath = buildPlexSubtitlePath(selectedSubtitleStream);
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
    contentFormat: plexSubtitleContentFormat(
      codec,
      directSubtitlePath,
      transcodeSubtitleAvailable,
    ),
    isText: isTextSubtitleCodec(codec),
  };
}

function subtitleTrackSupportsBurnIn(track: PlaybackSubtitleTrack) {
  return Boolean(track.isText && track.contentUrl);
}

async function fetchMetadataItem(
  context: PlexSourceContext,
  item: PlexMetadataItem,
) {
  const id = metadataId(item);
  if (!id) {
    return;
  }

  const data = (await fetchPmsMetadata(context, [id])) as PlexMetadataData;
  return data?.MediaContainer?.Metadata?.[0];
}

async function enrichMetadataItem(
  context: PlexSourceContext,
  item: PlexMetadataItem,
) {
  try {
    const fullItem = await fetchMetadataItem(context, item);
    if (!fullItem) {
      return item;
    }

    return {
      ...item,
      ...fullItem,
      User: item.User,
      Player: item.Player,
      Session: item.Session,
    };
  } catch (error) {
    logger.warn("Could not fetch Plex metadata.", {
      ...logErrorFields(error),
      "metadata.path": metadataPath(item) ?? "Plex item",
      "source.id": context.sourceId,
      "source.base_url": sanitizeUrlForLog(context.baseUrl),
    });
    return item;
  }
}

function createExportMetadata(
  session: ProviderSessionRecord,
  context: PlexSourceContext,
  item: PlexMetadataItem,
): MediaExportMetadata {
  const imagePath =
    metadataHdImagePath(item, context) ?? metadataImagePath(item);
  const guid = stringValue(item?.guid);

  return {
    providerId: "plex",
    itemType: stringValue(item?.type) ?? "video",
    title: stringValue(item?.title),
    sourceTitle: buildSourceTitle(item),
    showTitle: stringValue(item?.grandparentTitle),
    seasonTitle: stringValue(item?.parentTitle),
    seasonNumber: numberValue(item?.parentIndex),
    episodeNumber: numberValue(item?.index),
    year: numberValue(item?.year),
    date: stringValue(item?.originallyAvailableAt),
    description: stringValue(item?.summary),
    tagline: stringValue(item?.tagline),
    studio: stringValue(item?.studio),
    network:
      stringValue(item?.Network?.title) ?? stringValue(item?.Network?.tag),
    contentRating: stringValue(item?.contentRating),
    genres: tagValues(item?.Genre),
    directors: tagValues(item?.Director),
    writers: tagValues(item?.Writer),
    actors: tagValues(item?.Role).slice(0, 12),
    guids: uniqueStrings([guid, ...tagValues(item?.Guid)]),
    ratingKey: stringValue(item?.ratingKey),
    imageUrl: imagePath
      ? createMediaHandle(session, context, imagePath)
      : undefined,
  };
}

function fallbackPartPath(part: PlexPart | undefined) {
  if (!part?.id) {
    return;
  }

  if (typeof part.key === "string" && part.key) {
    return part.key;
  }

  const file = stringValue(part.file);
  if (file) {
    const filename = file.split(/[/\\]/).pop() || "file";
    const changestamp = part.updatedAt ?? part.createdAt;
    if (changestamp) {
      return `/library/parts/${part.id}/${changestamp}/${encodeURIComponent(filename)}`;
    }
    return `/library/parts/${part.id}/${encodeURIComponent(filename)}`;
  }

  return `/library/parts/${part.id}/file`;
}

async function resolveMediaPath(
  context: PlexSourceContext,
  item: PlexMetadataItem,
  enrichedItem?: PlexMetadataItem,
  selection?: PlexMediaSelection,
) {
  const directPath = fallbackPartPath(
    resolveSelectedPart(item, selection)?.part,
  );
  if (directPath) {
    return directPath;
  }

  const enrichedPath = fallbackPartPath(
    resolveSelectedPart(enrichedItem, selection)?.part,
  );
  if (enrichedPath) {
    return enrichedPath;
  }

  const id = metadataId(item);
  const path = metadataPath(item);
  if (!id) {
    return;
  }

  try {
    const data = (await fetchPmsMetadata(context, [id])) as PlexMetadataData;
    const fullItem = data?.MediaContainer?.Metadata?.[0];
    return fallbackPartPath(resolveSelectedPart(fullItem, selection)?.part);
  } catch (error) {
    logger.warn("Could not resolve Plex media part.", {
      ...logErrorFields(error),
      "metadata.path": path,
      "source.id": context.sourceId,
      "source.base_url": sanitizeUrlForLog(context.baseUrl),
    });
    return;
  }
}

function playbackSessionIdentity(item: PlexMetadataItem) {
  return String(
    item?.sessionKey ??
      item?.Session?.id ??
      playbackFallbackIdentity(item) ??
      randomUUID(),
  );
}

export function createPlexViewerAvatarUrl(
  session: ProviderSessionRecord,
  context: PlexSourceContext,
  item: PlexMetadataItem,
) {
  const avatarPath = stringValue(item?.User?.thumb);
  return avatarPath
    ? createMediaHandle(session, context, avatarPath)
    : undefined;
}

function playbackViewer(
  session: ProviderSessionRecord,
  context: PlexSourceContext,
  item: PlexMetadataItem,
  sourceId: string,
  sessionId: string,
) {
  const externalId = stringValue(item?.User?.id);
  return {
    id: externalId
      ? `plex:user:${externalId}`
      : `plex:synthetic:${sourceId}:${sessionId}`,
    providerId: "plex" as const,
    externalId,
    name: stringValue(item?.User?.title) ?? "Unknown User",
    avatarUrl: createPlexViewerAvatarUrl(session, context, item),
  };
}

async function normalizeCurrentPlayback(
  session: ProviderSessionRecord,
  source: MediaSource,
  context: PlexSourceContext,
  data: PlexCurrentlyPlayingData,
): Promise<CurrentlyPlayingEntry[]> {
  const metadata = data?.MediaContainer?.Metadata;
  if (!Array.isArray(metadata)) {
    return [];
  }

  const uniqueMetadata = dedupeCurrentlyPlayingMetadata(metadata);

  return Promise.all(
    uniqueMetadata.map(async (item) => {
      const sessionId = playbackSessionIdentity(item);
      const transcodeSessionId = createCliparrPlexTranscodeSessionId(
        source.id,
        sessionId,
      );
      const mediaSelection = deriveMediaSelection(item);
      const enrichedItem = await enrichMetadataItem(context, item);
      const mediaPath = await resolveMediaPath(
        context,
        item,
        enrichedItem,
        mediaSelection,
      );
      const previewPath = createPreviewPath(
        enrichedItem,
        transcodeSessionId,
        mediaSelection,
      );
      const thumbPath = metadataImagePath(enrichedItem);
      const selectedAudioTrack = deriveSelectedAudioTrack(
        enrichedItem,
        mediaSelection,
      );
      const selectedSubtitleTrack = deriveSelectedSubtitleTrack(
        enrichedItem,
        mediaSelection,
      );
      const subtitleTracks = deriveSubtitleTracks(
        session,
        context,
        enrichedItem,
        sessionId,
        mediaSelection,
      ).filter((track) => subtitleTrackSupportsBurnIn(track));
      const selectedPart = resolveSelectedPart(
        enrichedItem,
        mediaSelection,
      )?.part;
      const audioStreams = selectedPart
        ? streamEntries(selectedPart).filter((stream) => isAudioStream(stream))
        : [];
      const videoStreams = selectedPart
        ? streamEntries(selectedPart).filter((stream) => isVideoStream(stream))
        : [];
      const duration =
        Number(
          enrichedItem.duration ??
            asArray(enrichedItem.Media)[0]?.duration ??
            0,
        ) / 1000;
      const exportEstimateMetadata = createPlexExportEstimateMetadata(
        enrichedItem,
        mediaSelection,
        duration,
      );
      const playheadSeconds = playheadSecondsFromViewOffset(item?.viewOffset);
      const playerTitle = stringValue(item.Player?.title) ?? "Unknown Device";
      const playerState = stringValue(item.Player?.state) ?? "unknown";
      const thumbUrl = thumbPath
        ? createMediaHandle(session, context, thumbPath)
        : undefined;
      const mediaUrl = mediaPath
        ? createMediaHandle(session, context, mediaPath)
        : undefined;
      const hlsUrl = previewPath
        ? createMediaHandle(session, context, previewPath, {
            playbackSessionId: sessionId,
          })
        : undefined;
      const missingPreviewPath =
        !previewPath && itemTypeValue(enrichedItem) !== "track";
      const unresolvedSelectedAudioTrack =
        !selectedAudioTrack && audioStreams.length > 1;
      const playbackDiagnostics = {
        sessionId: session.id,
        sourceId: source.id,
        providerAccountId: source.providerAccountId,
        playbackSessionId: sessionId,
        transcodeSessionId,
        currentlyPlayingItem: {
          id: `${source.id}:${sessionId}`,
          title: itemTitleValue(enrichedItem),
          type: itemTypeValue(enrichedItem) || "video",
          duration,
          playheadSeconds: playheadSeconds ?? null,
          playerTitle,
          playerState,
          mediaUrl: mediaUrl ?? null,
          hlsUrl: hlsUrl ?? null,
          selectedAudioTrack: selectedAudioTrack ?? null,
          exportEstimateMetadata: exportEstimateMetadata ?? null,
        },
        metadataPath: metadataPath(enrichedItem) ?? null,
        mediaId: mediaSelection?.mediaId ?? null,
        mediaIndex: mediaSelection?.mediaIndex ?? null,
        partId: mediaSelection?.partId ?? null,
        partIndex: mediaSelection?.partIndex ?? null,
        videoStreamCount: videoStreams.length,
        audioStreamCount: audioStreams.length,
        videoStreams: videoStreams.map((stream, index) => ({
          trackNumber: index + 1,
          streamId: idValue(stream?.id) ?? null,
          title:
            stringValue(stream?.title) ??
            stringValue(stream?.extendedDisplayTitle) ??
            stringValue(stream?.displayTitle) ??
            null,
          codec: stringValue(stream?.codec) ?? null,
          width: numberValue(stream?.width) ?? null,
          height: numberValue(stream?.height) ?? null,
          selected: isSelectedEntry(stream),
        })),
        hasMultipleAudioStreams: audioStreams.length > 1,
        audioStreams: audioStreams.map((stream, index) => ({
          trackNumber: index + 1,
          streamId: idValue(stream?.id) ?? null,
          languageCode:
            stringValue(stream?.languageCode) ??
            stringValue(stream?.languageTag) ??
            null,
          title: selectedAudioTrackTitle(stream) ?? null,
          codec: stringValue(stream?.codec) ?? null,
          selected: isSelectedEntry(stream),
        })),
      };

      logger.debug(
        "Plex playback diagnostics for currently playing item.",
        playbackDiagnostics,
      );

      if (missingPreviewPath) {
        logger.debug(
          "Plex playback item did not produce an HLS preview path.",
          playbackDiagnostics,
        );
      }

      if (unresolvedSelectedAudioTrack) {
        logger.debug(
          "Plex playback item has multiple audio streams without a resolved selected audio track.",
          playbackDiagnostics,
        );
      }

      return {
        viewer: playbackViewer(session, context, item, source.id, sessionId),
        item: {
          id: `${source.id}:${sessionId}`,
          source: {
            id: source.id,
            name: source.name,
            providerId: "plex",
          },
          title: itemTitleValue(enrichedItem),
          type: itemTypeValue(enrichedItem) || "video",
          duration,
          playheadSeconds,
          playerTitle,
          playerState,
          thumbUrl,
          mediaUrl,
          hlsUrl,
          previewUrl: hlsUrl,
          previewFormat: previewPath ? "hls" : undefined,
          selectedAudioTrack,
          selectedSubtitleTrack,
          subtitleTracks,
          exportMetadata: createExportMetadata(session, context, enrichedItem),
          exportEstimateMetadata,
        },
      };
    }),
  );
}

export async function listCurrentlyPlaying(
  session: ProviderSessionRecord,
  source: MediaSource,
) {
  const { context, data } = await fetchCurrentlyPlayingData(source);
  return normalizeCurrentPlayback(session, source, context, data);
}

export async function proxyMedia(
  session: ProviderSessionRecord,
  handleId: string,
  request: Request,
  res: Response,
) {
  const handle = session.mediaHandles.get(handleId);
  if (!handle) {
    throw createApiError(
      404,
      "media_not_found",
      "Media handle was not found or has expired",
    );
  }

  handle.lastAccessedAt = Date.now();

  const url = mediaHandleRequestUrl(handle);
  const useProviderAuth = shouldAttachProviderAuth(handle);
  const headers = useProviderAuth
    ? plexMediaHeaders({
        "X-Plex-Token": handle.token,
      })
    : new Headers();

  const accept = request.header("accept");
  const requestedRange = request.header("range") ?? undefined;
  const range = shouldForwardMediaRange(handle, requestedRange);
  if (accept) {
    headers.set("Accept", accept);
  }
  if (range) {
    headers.set("Range", range);
  }

  const playbackSessionId = useProviderAuth
    ? (handle.providerMetadata?.plex?.playbackSessionId ??
      transcodeSessionId(handle.path))
    : null;
  if (playbackSessionId) {
    headers.set("X-Plex-Session-Identifier", playbackSessionId);
  }

  logger.trace("Fetching Plex media.", {
    "media.handle.id": handle.id,
    "session.id": session.id,
    "source.id": handle.sourceId,
    "upstream.url": sanitizeLoggedMediaPath(url.toString()),
    "provider.auth.attached": useProviderAuth,
    "media.range.present": Boolean(range),
    "http.accept": accept,
    "plex.playback_session.id": playbackSessionId,
  });

  await proxyProviderMediaResponse(
    session,
    handle,
    {
      accept: accept ?? undefined,
      range: range ?? undefined,
    },
    async () => {
      const upstream = await fetchMediaHandleRequest(handle, { headers });
      if (!upstream.ok && upstream.status !== 206) {
        const body = await upstream.text();
        const detail = body.slice(0, 400).replaceAll(/\s+/g, " ").trim();
        logger.warn("Plex media request failed.", {
          ...logEventFields("media.proxy.upstream", "failure"),
          "media.handle.id": handle.id,
          "session.id": session.id,
          "source.id": handle.sourceId,
          "upstream.url": sanitizeLoggedMediaPath(url.toString()),
          "upstream.status_code": upstream.status,
          "upstream.detail": detail,
          "provider.auth.attached": useProviderAuth,
          "media.range.present": Boolean(range),
          "http.accept": accept,
          "plex.playback_session.id": playbackSessionId,
        });
        throw createApiError(
          upstream.status,
          "plex_media_failed",
          detail
            ? `Plex media request failed: ${detail}`
            : "Plex media request failed",
        );
      }

      return upstream;
    },
    res,
  );
}
