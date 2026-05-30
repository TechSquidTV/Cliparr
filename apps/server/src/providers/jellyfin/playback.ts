import type { Request, Response } from "express";
import {
  logErrorFields,
  logEventFields,
  sanitizeUrlForLog,
} from "@cliparr/shared/logging";
import type { MediaSource } from "#/db/mediaSourcesRepository.js";
import { ApiError } from "#/http/errors.js";
import { getServerLogger } from "#/logging.js";
import type { ProviderSessionRecord } from "#/session/store.js";
import type {
  CurrentlyPlayingEntry,
  MediaExportMetadata,
  PlaybackAudioSelection,
  PlaybackSubtitleSelection,
  PlaybackSubtitleTrack,
} from "#/providers/types.js";
import {
  createProviderMediaHandle,
  fetchMediaHandleRequest,
  mediaHandleRequestUrl,
  playlistBasePath,
  proxyProviderMediaResponse,
  sanitizeLoggedMediaPath,
  shouldAttachProviderAuth,
  shouldForwardMediaRange,
} from "#/providers/shared/mediaProxy.js";
import {
  isTextSubtitleCodec,
  normalizeSubtitleCodec,
  subtitleContentFormat,
} from "#/providers/shared/subtitles.js";
import {
  asArray,
  buildEpisodeSourceTitle,
  errorMessage,
  numberValue,
  stringValue,
  uniqueStrings,
} from "#/providers/shared/utils.js";
import {
  booleanValue,
  fetchItem,
  fetchPlaybackInfo,
  fetchSessions,
  jellyfinHeaders,
  JELLYFIN_REQUEST_TIMEOUT_MS,
  sourceContext,
  type JellyfinItem,
  type JellyfinMediaStream,
  type JellyfinPlaybackInfo,
  type JellyfinSessionInfo,
  type JellyfinSourceContext,
} from "#/providers/jellyfin/shared.js";

const logger = getServerLogger(["provider", "jellyfin", "playback"]);
const HD_ARTWORK_SIZE = 1920;
const HD_ARTWORK_QUALITY = 96;

function createMediaHandle(
  session: ProviderSessionRecord,
  context: JellyfinSourceContext,
  path: string,
  options: { basePath?: string } = {},
) {
  return createProviderMediaHandle(
    session,
    {
      providerId: "jellyfin",
      sourceId: context.sourceId,
      baseUrl: context.baseUrl,
      token: context.token,
      deviceId: context.deviceId,
    },
    path,
    options,
  );
}

function ticksToSeconds(value: number | null | undefined) {
  const ticks = Number(value);
  if (!Number.isFinite(ticks) || ticks <= 0) {
    return 0;
  }

  return ticks / 10_000_000;
}

export function playheadSecondsFromPositionTicks(
  value: number | null | undefined,
) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const ticks = Number(value);
  if (!Number.isFinite(ticks) || ticks < 0) {
    return undefined;
  }

  return ticks / 10_000_000;
}

function itemType(item: JellyfinItem) {
  return stringValue(item?.Type) ?? stringValue(item?.MediaType) ?? "Video";
}

function itemTitle(item: JellyfinItem) {
  return (
    stringValue(item?.Name) ?? stringValue(item?.EpisodeTitle) ?? "Untitled"
  );
}

function buildSourceTitle(item: JellyfinItem) {
  const title = itemTitle(item);
  if (itemType(item) !== "Episode") {
    return title;
  }

  return (
    buildEpisodeSourceTitle({
      title,
      seriesTitle: stringValue(item?.SeriesName),
      seasonNumber: numberValue(item?.ParentIndexNumber),
      episodeNumber: numberValue(item?.IndexNumber),
    }) ?? title
  );
}

function itemImagePath(item: JellyfinItem) {
  const itemId = stringValue(item?.Id);
  const imageTags = item?.ImageTags ?? {};
  const type = itemType(item).toLowerCase();

  if (type === "audio") {
    const albumId = stringValue(item?.AlbumId);
    const albumTag = stringValue(item?.AlbumPrimaryImageTag);
    if (albumId && albumTag) {
      return `/Items/${encodeURIComponent(albumId)}/Images/Primary?tag=${encodeURIComponent(albumTag)}`;
    }
  }

  if (type === "episode") {
    const parentThumbItemId = stringValue(item?.ParentThumbItemId);
    const parentThumbTag = stringValue(item?.ParentThumbImageTag);
    if (parentThumbItemId && parentThumbTag) {
      return `/Items/${encodeURIComponent(parentThumbItemId)}/Images/Thumb?tag=${encodeURIComponent(parentThumbTag)}`;
    }

    const seriesId = stringValue(item?.SeriesId);
    const seriesTag = stringValue(item?.SeriesPrimaryImageTag);
    if (seriesId && seriesTag) {
      return `/Items/${encodeURIComponent(seriesId)}/Images/Primary?tag=${encodeURIComponent(seriesTag)}`;
    }
  }

  const primaryTag = stringValue(imageTags.Primary);
  if (itemId && primaryTag) {
    return `/Items/${encodeURIComponent(itemId)}/Images/Primary?tag=${encodeURIComponent(primaryTag)}`;
  }

  const thumbTag = stringValue(imageTags.Thumb);
  if (itemId && thumbTag) {
    return `/Items/${encodeURIComponent(itemId)}/Images/Thumb?tag=${encodeURIComponent(thumbTag)}`;
  }

  return undefined;
}

function withHdImageOptions(path: string) {
  const url = new URL(path, "http://cliparr.local");
  url.searchParams.set("maxWidth", String(HD_ARTWORK_SIZE));
  url.searchParams.set("maxHeight", String(HD_ARTWORK_SIZE));
  url.searchParams.set("quality", String(HD_ARTWORK_QUALITY));

  return `${url.pathname}${url.search}`;
}

function itemHdImagePath(item: JellyfinItem) {
  const imagePath = itemImagePath(item);
  return imagePath ? withHdImageOptions(imagePath) : undefined;
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

function currentMediaSourceId(
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

function currentMediaSource(
  sessionInfo: JellyfinSessionInfo | undefined,
  item: JellyfinItem,
  mediaSourceId: string | undefined,
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

function normalizedString(value: string | null | undefined) {
  return stringValue(value)?.toLowerCase() ?? "";
}

function isAudioMediaStream(stream: JellyfinMediaStream) {
  return normalizedString(stream?.Type) === "audio";
}

function isVideoMediaStream(stream: JellyfinMediaStream) {
  return normalizedString(stream?.Type) === "video";
}

function isSubtitleMediaStream(stream: JellyfinMediaStream) {
  return normalizedString(stream?.Type) === "subtitle";
}

function jellyfinAudioTrackTitle(stream: JellyfinMediaStream) {
  return stringValue(stream?.Title) ?? stringValue(stream?.DisplayTitle);
}

function jellyfinSubtitleTrackTitle(stream: JellyfinMediaStream) {
  return (
    stringValue(stream?.Title) ??
    stringValue(stream?.DisplayTitle) ??
    stringValue(stream?.Language)
  );
}

function deriveSelectedAudioTrack(
  sessionInfo: JellyfinSessionInfo,
  item: JellyfinItem,
  mediaSourceId: string | undefined,
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

  const selectedAudioStreamIndex =
    numberValue(sessionInfo?.PlayState?.AudioStreamIndex) ??
    numberValue(mediaSource?.DefaultAudioStreamIndex);

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
  if (selectedAudioTrackIndex < 0) {
    return undefined;
  }

  const selectedAudioStream = audioStreams[selectedAudioTrackIndex];
  return {
    trackNumber: selectedAudioTrackIndex + 1,
    languageCode: stringValue(selectedAudioStream?.Language),
    title: jellyfinAudioTrackTitle(selectedAudioStream),
  };
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
    return undefined;
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
  mediaSourceId: string | undefined,
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

function subtitleTrackSupportsBurnIn(track: PlaybackSubtitleTrack) {
  return Boolean(track.isText && track.contentUrl);
}

function buildStaticStreamPath(
  item: JellyfinItem,
  mediaSourceId: string | undefined,
  context: JellyfinSourceContext,
  playSessionId: string,
) {
  const itemId = stringValue(item?.Id);
  if (!itemId) {
    return undefined;
  }

  const isAudio = normalizedString(item?.MediaType) === "audio";
  const params = new URLSearchParams({
    static: "true",
    deviceId: context.deviceId,
    playSessionId,
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
  playSessionId: string,
) {
  const itemId = stringValue(item?.Id);
  if (
    !itemId ||
    normalizedString(item?.MediaType) === "audio" ||
    !mediaSourceId
  ) {
    return undefined;
  }

  const params = new URLSearchParams({
    mediaSourceId,
    deviceId: context.deviceId,
    playSessionId,
    maxAudioChannels: "2",
    audioCodec: "aac",
    enableAdaptiveBitrateStreaming: "false",
    alwaysBurnInSubtitleWhenTranscoding: "false",
  });

  return `/Videos/${encodeURIComponent(itemId)}/master.m3u8?${params.toString()}`;
}

function peopleNames(item: JellyfinItem, kind: string) {
  return uniqueStrings(
    asArray(item?.People).flatMap((person) => {
      if (stringValue(person?.Type) !== kind) {
        return [];
      }

      const name = stringValue(person?.Name);
      return name ? [name] : [];
    }),
  );
}

function studios(item: JellyfinItem) {
  return uniqueStrings(
    asArray(item?.Studios).map(
      (entry) => stringValue(entry?.Name) ?? stringValue(entry?.name),
    ),
  );
}

function providerGuids(item: JellyfinItem) {
  const providerIds = item?.ProviderIds;
  if (
    !providerIds ||
    typeof providerIds !== "object" ||
    Array.isArray(providerIds)
  ) {
    return [];
  }

  return uniqueStrings(
    Object.entries(providerIds).map(([provider, id]) => {
      const normalizedId = stringValue(id);
      return normalizedId
        ? `${provider.toLowerCase()}://${normalizedId}`
        : undefined;
    }),
  );
}

function firstTagline(item: JellyfinItem) {
  return uniqueStrings(
    asArray(item?.Taglines).map((value) => stringValue(value)),
  )[0];
}

function createExportMetadata(
  session: ProviderSessionRecord,
  context: JellyfinSourceContext,
  item: JellyfinItem,
): MediaExportMetadata {
  const imagePath = itemHdImagePath(item) ?? itemImagePath(item);

  return {
    providerId: "jellyfin",
    itemType: itemType(item).toLowerCase(),
    title: itemTitle(item),
    sourceTitle: buildSourceTitle(item),
    showTitle: stringValue(item?.SeriesName),
    seasonTitle: stringValue(item?.SeasonName),
    seasonNumber: numberValue(item?.ParentIndexNumber),
    episodeNumber: numberValue(item?.IndexNumber),
    year: numberValue(item?.ProductionYear),
    date: stringValue(item?.PremiereDate)?.slice(0, 10),
    description: stringValue(item?.Overview),
    tagline: firstTagline(item),
    studio: studios(item)[0],
    network: stringValue(item?.SeriesStudio) ?? stringValue(item?.ChannelName),
    contentRating: stringValue(item?.OfficialRating),
    genres: uniqueStrings(
      asArray(item?.Genres).map((value) => stringValue(value)),
    ),
    directors: peopleNames(item, "Director"),
    writers: uniqueStrings([
      ...peopleNames(item, "Writer"),
      ...peopleNames(item, "Author"),
    ]),
    actors: uniqueStrings([
      ...peopleNames(item, "Actor"),
      ...peopleNames(item, "GuestStar"),
      ...peopleNames(item, "Artist"),
    ]).slice(0, 12),
    guids: providerGuids(item),
    ratingKey: stringValue(item?.Id),
    imageUrl: imagePath
      ? createMediaHandle(session, context, imagePath)
      : undefined,
  };
}

async function enrichMetadataItem(
  context: JellyfinSourceContext,
  item: JellyfinItem,
) {
  const itemId = stringValue(item?.Id);
  if (!itemId) {
    return item;
  }

  try {
    const fullItem = await fetchItem(context, itemId);
    return {
      ...item,
      ...fullItem,
    };
  } catch (err) {
    logger.warn("Could not fetch Jellyfin metadata.", {
      ...logErrorFields(err),
      "metadata.item.id": itemId,
      "source.id": context.sourceId,
      "source.base_url": sanitizeUrlForLog(context.baseUrl),
    });
    return item;
  }
}

async function loadPlaybackInfo(
  context: JellyfinSourceContext,
  itemId: string,
) {
  try {
    return await fetchPlaybackInfo(context, itemId);
  } catch (err) {
    logger.warn("Could not fetch Jellyfin playback info.", {
      ...logErrorFields(err),
      "metadata.item.id": itemId,
      "source.id": context.sourceId,
      "source.base_url": sanitizeUrlForLog(context.baseUrl),
    });
    return undefined;
  }
}

function playbackItemIdentity(
  sourceId: string,
  clientSessionId: string | undefined,
  itemId: string,
  mediaSourceId: string | undefined,
) {
  return [
    sourceId,
    clientSessionId ?? "unknown-session",
    itemId,
    mediaSourceId ?? "unknown-media-source",
  ].join(":");
}

function playbackViewer(
  sourceId: string,
  sessionId: string,
  sessionInfo: JellyfinSessionInfo,
) {
  const externalId = stringValue(sessionInfo?.UserId);
  return {
    id: externalId
      ? `jellyfin:user:${externalId}`
      : `jellyfin:synthetic:${sourceId}:${sessionId}`,
    providerId: "jellyfin" as const,
    externalId,
    name: stringValue(sessionInfo?.UserName) ?? "Unknown User",
  };
}

async function normalizeCurrentPlayback(
  session: ProviderSessionRecord,
  source: MediaSource,
  context: JellyfinSourceContext,
  sessionInfo: JellyfinSessionInfo,
): Promise<CurrentlyPlayingEntry | undefined> {
  const nowPlayingItem = sessionInfo?.NowPlayingItem;
  if (!nowPlayingItem) {
    return undefined;
  }

  const itemId = stringValue(nowPlayingItem.Id);
  if (!itemId) {
    return undefined;
  }

  const [enrichedItem, playbackInfo] = await Promise.all([
    enrichMetadataItem(context, nowPlayingItem),
    loadPlaybackInfo(context, itemId),
  ]);
  const playSessionId = stringValue(playbackInfo?.PlaySessionId);
  const clientSessionId = stringValue(sessionInfo?.Id);
  const mediaSourceId = currentMediaSourceId(
    sessionInfo,
    enrichedItem,
    playbackInfo,
  );
  const mediaSource = currentMediaSource(
    sessionInfo,
    enrichedItem,
    mediaSourceId,
    playbackInfo,
  );
  const mediaPath = playSessionId
    ? buildStaticStreamPath(enrichedItem, mediaSourceId, context, playSessionId)
    : undefined;
  const previewPath = playSessionId
    ? buildPreviewPath(enrichedItem, mediaSourceId, context, playSessionId)
    : undefined;
  const imagePath = itemImagePath(enrichedItem);
  const selectedAudioTrack = deriveSelectedAudioTrack(
    sessionInfo,
    enrichedItem,
    mediaSourceId,
    playbackInfo,
  );
  const selectedSubtitleTrack = deriveSelectedSubtitleTrack(
    sessionInfo,
    enrichedItem,
    mediaSourceId,
    playbackInfo,
  );
  const subtitleTracks = deriveSubtitleTracks(
    session,
    context,
    enrichedItem,
    mediaSourceId,
    sessionInfo,
    playbackInfo,
  ).filter((track) => subtitleTrackSupportsBurnIn(track));
  const playerState = sessionInfo?.PlayState?.IsPaused ? "paused" : "playing";
  const audioStreams = asArray(mediaSource?.MediaStreams).filter((stream) =>
    isAudioMediaStream(stream),
  );
  const videoStreams = asArray(mediaSource?.MediaStreams).filter((stream) =>
    isVideoMediaStream(stream),
  );
  const duration = ticksToSeconds(
    enrichedItem?.RunTimeTicks ?? nowPlayingItem?.RunTimeTicks,
  );
  const playheadSeconds = playheadSecondsFromPositionTicks(
    sessionInfo?.PlayState?.PositionTicks,
  );
  const playerTitle =
    stringValue(sessionInfo?.DeviceName) ??
    stringValue(sessionInfo?.Client) ??
    stringValue(sessionInfo?.DeviceType) ??
    "Unknown Device";
  const thumbUrl = imagePath
    ? createMediaHandle(session, context, imagePath)
    : undefined;
  const mediaUrl = mediaPath
    ? createMediaHandle(session, context, mediaPath)
    : undefined;
  const hlsUrl = previewPath
    ? createMediaHandle(session, context, previewPath, {
        basePath: playlistBasePath(previewPath),
      })
    : undefined;
  const playbackItemId = playbackItemIdentity(
    source.id,
    clientSessionId,
    itemId,
    mediaSourceId,
  );
  const missingPreviewPath =
    !previewPath && normalizedString(enrichedItem?.MediaType) !== "audio";
  const unresolvedSelectedAudioTrack =
    !selectedAudioTrack && audioStreams.length > 1;
  const playbackDiagnostics = {
    sessionId: session.id,
    sourceId: source.id,
    providerAccountId: session.providerAccountId,
    playSessionId,
    currentlyPlayingItem: {
      id: playbackItemId,
      title: itemTitle(enrichedItem),
      type: itemType(enrichedItem).toLowerCase(),
      duration,
      playheadSeconds: playheadSeconds ?? null,
      playerTitle,
      playerState,
      mediaUrl: mediaUrl ?? null,
      hlsUrl: hlsUrl ?? null,
      selectedAudioTrack: selectedAudioTrack ?? null,
    },
    mediaSourceId: mediaSourceId ?? null,
    videoStreamCount: videoStreams.length,
    audioStreamCount: audioStreams.length,
    videoStreams: videoStreams.map((stream, index) => ({
      trackNumber: index + 1,
      streamIndex: numberValue(stream?.Index) ?? null,
      title:
        stringValue(stream?.Title) ?? stringValue(stream?.DisplayTitle) ?? null,
      codec: stringValue(stream?.Codec) ?? null,
      width: numberValue(stream?.Width) ?? null,
      height: numberValue(stream?.Height) ?? null,
      isDefault: booleanValue(stream?.IsDefault) ?? null,
    })),
    hasMultipleAudioStreams: audioStreams.length > 1,
    audioStreams: audioStreams.map((stream, index) => ({
      trackNumber: index + 1,
      streamIndex: numberValue(stream?.Index) ?? null,
      languageCode: stringValue(stream?.Language) ?? null,
      title: jellyfinAudioTrackTitle(stream) ?? null,
      codec: stringValue(stream?.Codec) ?? null,
      isDefault: booleanValue(stream?.IsDefault) ?? null,
    })),
    playStateAudioStreamIndex:
      numberValue(sessionInfo?.PlayState?.AudioStreamIndex) ?? null,
    defaultAudioStreamIndex:
      numberValue(mediaSource?.DefaultAudioStreamIndex) ?? null,
  };

  logger.debug(
    "Jellyfin playback diagnostics for currently playing item.",
    playbackDiagnostics,
  );

  if (missingPreviewPath) {
    logger.debug(
      "Jellyfin playback item did not produce an HLS preview path.",
      playbackDiagnostics,
    );
  }

  if (unresolvedSelectedAudioTrack) {
    logger.debug(
      "Jellyfin playback item has multiple audio streams without a resolved selected audio track.",
      playbackDiagnostics,
    );
  }

  return {
    viewer: playbackViewer(source.id, clientSessionId ?? itemId, sessionInfo),
    item: {
      id: playbackItemId,
      source: {
        id: source.id,
        name: source.name,
        providerId: "jellyfin",
      },
      title: itemTitle(enrichedItem),
      type: itemType(enrichedItem).toLowerCase(),
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
    },
  } satisfies CurrentlyPlayingEntry;
}

export function sourceSupportsCurrentlyPlaying(source: MediaSource) {
  if (!stringValue(source.credentials.accessToken)) {
    return false;
  }

  const isAdministrator = booleanValue(source.metadata.isAdministrator);
  return isAdministrator !== false;
}

export async function listCurrentlyPlaying(
  session: ProviderSessionRecord,
  source: MediaSource,
) {
  const context = sourceContext(source);
  const sessions = await fetchSessions(context);
  const activeSessions = sessions.filter((sessionInfo) =>
    Boolean(stringValue(sessionInfo?.NowPlayingItem?.Id)),
  );
  const entries = await Promise.all(
    activeSessions.map((sessionInfo) =>
      normalizeCurrentPlayback(session, source, context, sessionInfo),
    ),
  );

  return entries.filter((entry): entry is CurrentlyPlayingEntry =>
    Boolean(entry),
  );
}

export async function proxyMedia(
  session: ProviderSessionRecord,
  handleId: string,
  req: Request,
  res: Response,
) {
  const handle = session.mediaHandles.get(handleId);
  if (!handle) {
    throw new ApiError(
      404,
      "media_not_found",
      "Media handle was not found or has expired",
    );
  }

  handle.lastAccessedAt = Date.now();

  const accept = req.header("accept") ?? undefined;
  const useProviderAuth = shouldAttachProviderAuth(handle);
  const headers = useProviderAuth
    ? jellyfinHeaders({
        token: handle.token,
        deviceId: handle.deviceId,
        accept,
      })
    : new Headers(accept ? { Accept: accept } : undefined);
  const requestedRange = req.header("range") ?? undefined;
  const range = shouldForwardMediaRange(handle, requestedRange);
  if (range) {
    headers.set("Range", range);
  }

  const upstreamUrl = mediaHandleRequestUrl(handle).toString();

  logger.trace("Fetching Jellyfin media.", {
    "media.handle.id": handle.id,
    "session.id": session.id,
    "source.id": handle.sourceId,
    "upstream.url": sanitizeLoggedMediaPath(upstreamUrl),
    "provider.auth.attached": useProviderAuth,
    "media.range.present": Boolean(range),
    "http.accept": accept,
  });

  await proxyProviderMediaResponse(
    session,
    handle,
    {
      accept,
      range: range ?? undefined,
    },
    async () => {
      try {
        const upstream = await fetchMediaHandleRequest(handle, {
          headers,
          timeoutMs: JELLYFIN_REQUEST_TIMEOUT_MS,
        });

        if (!upstream.ok && upstream.status !== 206) {
          const detail = (await upstream.text())
            .slice(0, 400)
            .replace(/\s+/g, " ")
            .trim();
          throw new ApiError(
            upstream.status,
            "jellyfin_media_failed",
            detail
              ? `Jellyfin media request failed: ${detail}`
              : "Jellyfin media request failed",
          );
        }

        return upstream;
      } catch (err) {
        logger.warn("Jellyfin media request failed.", {
          ...logEventFields("media.proxy.upstream", "failure"),
          ...logErrorFields(err),
          "media.handle.id": handle.id,
          "session.id": session.id,
          "source.id": handle.sourceId,
          "upstream.url": sanitizeLoggedMediaPath(upstreamUrl),
          "provider.auth.attached": useProviderAuth,
          "media.range.present": Boolean(range),
          "http.accept": accept,
          "error.message": errorMessage(err),
        });
        throw err;
      }
    },
    res,
  );
}
