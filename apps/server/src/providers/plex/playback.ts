import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import { updateMediaSource, type MediaSource } from "../../db/mediaSourcesRepository.js";
import { ApiError } from "../../http/errors.js";
import { getServerLogger } from "../../logging.js";
import type { ProviderSessionRecord } from "../../session/store.js";
import type {
  CurrentlyPlayingEntry,
  MediaExportMetadata,
  PlaybackAudioSelection,
  ProviderConnection,
  ProviderResource,
} from "../types.js";
import {
  createProviderMediaHandle,
  mediaHandleRequestUrl,
  proxyProviderMediaResponse,
  sanitizeLoggedMediaPath,
  shouldAttachProviderAuth,
} from "../shared/mediaProxy.js";
import {
  asArray,
  buildEpisodeSourceTitle,
  errorMessage,
  numberValue,
  stringValue,
  uniqueStrings,
} from "../shared/utils.js";
import {
  buildSourceContext,
  candidateConnections,
  CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
  fetchPmsJson,
  plexMediaHeaders,
  sourceResource,
  unreachableConnectionMessage,
  type PlexSourceContext,
} from "./shared.js";
import {
  PLEX_BASE_URL_MODE_AUTO,
  PLEX_BASE_URL_MODE_MANUAL,
  type PlexBaseUrlMode,
  withPlexBaseUrlMode,
} from "./connectionState.js";

const logger = getServerLogger(["providers", "plex"]);

function createMediaHandle(
  session: ProviderSessionRecord,
  context: PlexSourceContext,
  path: string,
  options: { basePath?: string } = {}
) {
  return createProviderMediaHandle(session, {
    providerId: "plex",
    sourceId: context.sourceId,
    baseUrl: context.baseUrl,
    token: context.token,
  }, path, options);
}

function metadataPath(item: any) {
  if (item?.ratingKey) {
    return `/library/metadata/${item.ratingKey}`;
  }
  if (typeof item?.key === "string" && item.key.startsWith("/library/metadata/")) {
    return item.key;
  }
  return undefined;
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
    return trimmed ? trimmed : undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  return undefined;
}

function isSelectedEntry(entry: any) {
  return entry?.selected === true || entry?.selected === 1 || entry?.selected === "1";
}

function mediaEntries(item: any) {
  return asArray(item?.Media);
}

function partEntries(media: any) {
  return asArray(media?.Part);
}

function streamEntries(part: any) {
  return asArray(part?.Stream);
}

function selectedIndex(entries: any[]) {
  const index = entries.findIndex((entry) => isSelectedEntry(entry));
  return index >= 0 ? index : 0;
}

function deriveMediaSelection(item: any): PlexMediaSelection | undefined {
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

function resolveSelectedPart(item: any, selection?: PlexMediaSelection) {
  const media = mediaEntries(item);
  if (media.length === 0) {
    return undefined;
  }

  let mediaIndex = selection?.mediaId
    ? media.findIndex((entry) => idValue(entry?.id) === selection.mediaId)
    : -1;
  if (mediaIndex < 0 && selection?.mediaIndex !== undefined && media[selection.mediaIndex]) {
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
  if (partIndex < 0 && selection?.partIndex !== undefined && parts[selection.partIndex]) {
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
  item: any,
  playbackSessionId: string,
  selection?: PlexMediaSelection
) {
  const path = metadataPath(item);
  if (!path) {
    return undefined;
  }

  const resolvedSelection = resolveSelectedPart(item, selection);
  const params = new URLSearchParams({
    path,
    transcodeSessionId: playbackSessionId,
    protocol: "hls",
    directPlay: "0",
    directStream: "0",
    directStreamAudio: "0",
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

function transcodeSessionId(path: string) {
  try {
    return new URL(path, "http://cliparr.local").searchParams.get("transcodeSessionId");
  } catch {
    return null;
  }
}

function isRetryableConnectionError(err: unknown) {
  if (!(err instanceof ApiError)) {
    return true;
  }

  return err.code === "plex_request_failed" && err.status !== 401 && err.status !== 403;
}

function persistWorkingSourceConnection(
  source: MediaSource,
  connections: ProviderResource["connections"],
  connection: ProviderConnection,
  options: { baseUrlMode: PlexBaseUrlMode; manualConnectionId?: string }
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
    source.baseUrl === connection.uri
    && stringValue(source.connection.selectedConnectionId) === connection.id
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

  for (const connection of candidateConnections(resource, preferredConnectionId, baseUrlMode)) {
    const context = buildSourceContext(source.id, resource.accessToken, connection);

    try {
      const data = await fetchPmsJson(context, "/status/sessions", {
        timeoutMs: CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
      });
      persistWorkingSourceConnection(source, persistedConnections, connection, {
        baseUrlMode,
        manualConnectionId,
      });
      return { context, data };
    } catch (err) {
      if (!isRetryableConnectionError(err)) {
        throw err;
      }

      failures.push(`${connection.uri}: ${errorMessage(err)}`);
    }
  }

  throw new ApiError(
    502,
    "plex_unreachable",
    unreachableConnectionMessage(resource, failures, baseUrlMode)
  );
}

function playbackFallbackIdentity(item: any) {
  const userId = idValue(item?.User?.id);
  const playerId = stringValue(item?.Player?.machineIdentifier) ?? stringValue(item?.Player?.title);
  const itemId = idValue(item?.ratingKey) ?? stringValue(item?.key) ?? metadataPath(item);
  const parts = [userId, playerId, itemId].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(":") : undefined;
}

function playbackDeduplicationKey(item: any) {
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

  return undefined;
}

function dedupeCurrentlyPlayingMetadata(metadata: any[]) {
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

function tagValues(value: unknown) {
  return uniqueStrings(
    asArray(value as any).map((entry: any) => {
      if (typeof entry === "string") {
        return stringValue(entry);
      }

      return stringValue(entry?.tag) ?? stringValue(entry?.id) ?? stringValue(entry?.ratingKey);
    })
  );
}

function metadataImagePath(item: any) {
  if (item?.type === "episode") {
    return stringValue(item.grandparentThumb) ?? stringValue(item.parentThumb) ?? stringValue(item.thumb);
  }

  return stringValue(item?.thumb) ?? stringValue(item?.grandparentThumb) ?? stringValue(item?.parentThumb);
}

function buildSourceTitle(item: any) {
  const title = stringValue(item?.title);
  if (item?.type !== "episode") {
    return title;
  }

  return buildEpisodeSourceTitle({
    title,
    seriesTitle: stringValue(item.grandparentTitle),
    seasonNumber: numberValue(item.parentIndex),
    episodeNumber: numberValue(item.index),
  }) ?? title;
}

function isAudioStream(stream: any) {
  return numberValue(stream?.streamType) === 2;
}

function selectedAudioTrackTitle(stream: any) {
  return stringValue(stream?.title)
    ?? stringValue(stream?.extendedDisplayTitle)
    ?? stringValue(stream?.displayTitle);
}

function deriveSelectedAudioTrack(
  item: any,
  selection?: PlexMediaSelection
): PlaybackAudioSelection | undefined {
  const part = resolveSelectedPart(item, selection)?.part;
  if (!part) {
    return undefined;
  }

  const audioStreams = streamEntries(part).filter((stream) => isAudioStream(stream));
  if (audioStreams.length === 0) {
    return undefined;
  }

  const selectedAudioIndex = audioStreams.findIndex((stream) => isSelectedEntry(stream));
  if (selectedAudioIndex < 0 && audioStreams.length > 1) {
    return undefined;
  }

  const trackIndex = selectedAudioIndex >= 0 ? selectedAudioIndex : 0;
  const selectedAudioStream = audioStreams[trackIndex];

  return {
    trackNumber: trackIndex + 1,
    languageCode: stringValue(selectedAudioStream?.languageCode)
      ?? stringValue(selectedAudioStream?.languageTag),
    title: selectedAudioTrackTitle(selectedAudioStream),
  };
}

async function fetchMetadataItem(context: PlexSourceContext, item: any) {
  const path = metadataPath(item);
  if (!path) {
    return undefined;
  }

  const data = await fetchPmsJson(context, path) as any;
  return data?.MediaContainer?.Metadata?.[0];
}

async function enrichMetadataItem(context: PlexSourceContext, item: any) {
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
  } catch (err) {
    logger.warn("Could not fetch Plex metadata for {metadataPath}.", {
      metadataPath: metadataPath(item) ?? "Plex item",
      sourceId: context.sourceId,
      baseUrl: context.baseUrl,
      errorMessage: errorMessage(err),
    });
    return item;
  }
}

function createExportMetadata(
  session: ProviderSessionRecord,
  context: PlexSourceContext,
  item: any
): MediaExportMetadata {
  const imagePath = metadataImagePath(item);
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
    network: stringValue(item?.Network?.title) ?? stringValue(item?.Network?.tag),
    contentRating: stringValue(item?.contentRating),
    genres: tagValues(item?.Genre),
    directors: tagValues(item?.Director),
    writers: tagValues(item?.Writer),
    actors: tagValues(item?.Role).slice(0, 12),
    guids: uniqueStrings([guid, ...tagValues(item?.Guid)]),
    ratingKey: stringValue(item?.ratingKey),
    imageUrl: imagePath ? createMediaHandle(session, context, imagePath) : undefined,
  };
}

function fallbackPartPath(part: any) {
  if (!part?.id) {
    return undefined;
  }

  if (typeof part.key === "string" && part.key) {
    return part.key;
  }

  if (part.file) {
    const filename = String(part.file).split(/[\\/]/).pop() || "file";
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
  item: any,
  enrichedItem?: any,
  selection?: PlexMediaSelection
) {
  const directPath = fallbackPartPath(resolveSelectedPart(item, selection)?.part);
  if (directPath) {
    return directPath;
  }

  const enrichedPath = fallbackPartPath(resolveSelectedPart(enrichedItem, selection)?.part);
  if (enrichedPath) {
    return enrichedPath;
  }

  const path = metadataPath(item);
  if (!path) {
    return undefined;
  }

  try {
    const data = await fetchPmsJson(context, path) as any;
    const fullItem = data?.MediaContainer?.Metadata?.[0];
    return fallbackPartPath(resolveSelectedPart(fullItem, selection)?.part);
  } catch (err) {
    logger.warn("Could not resolve Plex media part for {metadataPath}.", {
      metadataPath: path,
      sourceId: context.sourceId,
      baseUrl: context.baseUrl,
      errorMessage: errorMessage(err),
    });
    return undefined;
  }
}

function playbackSessionIdentity(item: any) {
  return String(
    item?.sessionKey
    ?? item?.Session?.id
    ?? playbackFallbackIdentity(item)
    ?? randomUUID()
  );
}

function playbackViewer(item: any, sourceId: string, sessionId: string) {
  const externalId = stringValue(item?.User?.id);
  return {
    id: externalId ? `plex:user:${externalId}` : `plex:synthetic:${sourceId}:${sessionId}`,
    providerId: "plex" as const,
    externalId,
    name: stringValue(item?.User?.title) ?? "Unknown User",
    avatarUrl: stringValue(item?.User?.thumb),
  };
}

async function normalizeCurrentPlayback(
  session: ProviderSessionRecord,
  source: MediaSource,
  context: PlexSourceContext,
  data: any
): Promise<CurrentlyPlayingEntry[]> {
  const metadata = data?.MediaContainer?.Metadata;
  if (!Array.isArray(metadata)) {
    return [];
  }

  const uniqueMetadata = dedupeCurrentlyPlayingMetadata(metadata);

  return Promise.all(uniqueMetadata.map(async (item: any) => {
    const sessionId = playbackSessionIdentity(item);
    const mediaSelection = deriveMediaSelection(item);
    const enrichedItem = await enrichMetadataItem(context, item);
    const mediaPath = await resolveMediaPath(context, item, enrichedItem, mediaSelection);
    const previewPath = createPreviewPath(enrichedItem, sessionId, mediaSelection);
    const thumbPath = metadataImagePath(enrichedItem);
    const selectedAudioTrack = deriveSelectedAudioTrack(enrichedItem, mediaSelection);
    const selectedPart = resolveSelectedPart(enrichedItem, mediaSelection)?.part;
    const audioStreams = selectedPart ? streamEntries(selectedPart).filter((stream) => isAudioStream(stream)) : [];
    const duration = Number(enrichedItem.duration ?? asArray(enrichedItem.Media)[0]?.duration ?? 0) / 1000;
    const playerTitle = String(item.Player?.title ?? "Unknown Device");
    const playerState = String(item.Player?.state ?? "unknown");
    const thumbUrl = thumbPath ? createMediaHandle(session, context, thumbPath) : undefined;
    const mediaUrl = mediaPath ? createMediaHandle(session, context, mediaPath) : undefined;
    const hlsUrl = previewPath ? createMediaHandle(session, context, previewPath) : undefined;
    const missingPreviewPath = !previewPath && String(enrichedItem?.type ?? "").toLowerCase() !== "track";
    const unresolvedSelectedAudioTrack = !selectedAudioTrack && audioStreams.length > 1;
    const playbackDiagnostics = {
      sessionId: session.id,
      sourceId: source.id,
      providerAccountId: session.providerAccountId,
      playbackSessionId: sessionId,
      currentlyPlayingItem: {
        id: `${source.id}:${sessionId}`,
        title: String(enrichedItem.title ?? "Untitled"),
        type: String(enrichedItem.type ?? "video"),
        duration,
        playerTitle,
        playerState,
        mediaUrl: mediaUrl ?? null,
        hlsUrl: hlsUrl ?? null,
        selectedAudioTrack: selectedAudioTrack ?? null,
      },
      metadataPath: metadataPath(enrichedItem) ?? null,
      mediaId: mediaSelection?.mediaId ?? null,
      mediaIndex: mediaSelection?.mediaIndex ?? null,
      partId: mediaSelection?.partId ?? null,
      partIndex: mediaSelection?.partIndex ?? null,
      audioStreamCount: audioStreams.length,
      hasMultipleAudioStreams: audioStreams.length > 1,
      audioStreams: audioStreams.map((stream, index) => ({
        trackNumber: index + 1,
        streamId: idValue(stream?.id) ?? null,
        languageCode: stringValue(stream?.languageCode) ?? stringValue(stream?.languageTag) ?? null,
        title: selectedAudioTrackTitle(stream) ?? null,
        codec: stringValue(stream?.codec) ?? null,
        selected: isSelectedEntry(stream),
      })),
    };

    logger.debug("Plex playback diagnostics for currently playing item.", playbackDiagnostics);

    if (missingPreviewPath) {
      logger.debug("Plex playback item did not produce an HLS preview path.", playbackDiagnostics);
    }

    if (unresolvedSelectedAudioTrack) {
      logger.debug("Plex playback item has multiple audio streams without a resolved selected audio track.", playbackDiagnostics);
    }

    return {
      viewer: playbackViewer(item, source.id, sessionId),
      item: {
        id: `${source.id}:${sessionId}`,
        source: {
          id: source.id,
          name: source.name,
          providerId: "plex",
        },
        title: String(enrichedItem.title ?? "Untitled"),
        type: String(enrichedItem.type ?? "video"),
        duration,
        playerTitle,
        playerState,
        thumbUrl,
        mediaUrl,
        hlsUrl,
        selectedAudioTrack,
        exportMetadata: createExportMetadata(session, context, enrichedItem),
      },
    };
  }));
}

export async function listCurrentlyPlaying(session: ProviderSessionRecord, source: MediaSource) {
  const { context, data } = await fetchCurrentlyPlayingData(source);
  return normalizeCurrentPlayback(session, source, context, data);
}

export async function proxyMedia(
  session: ProviderSessionRecord,
  handleId: string,
  req: Request,
  res: Response
) {
  const handle = session.mediaHandles.get(handleId);
  if (!handle) {
    throw new ApiError(404, "media_not_found", "Media handle was not found or has expired");
  }

  handle.lastAccessedAt = Date.now();

  const url = mediaHandleRequestUrl(handle);
  const useProviderAuth = shouldAttachProviderAuth(handle);
  const headers = useProviderAuth
    ? plexMediaHeaders({
        "X-Plex-Token": handle.token,
      })
    : new Headers();

  const accept = req.header("accept");
  const range = req.header("range");
  if (accept) {
    headers.set("Accept", accept);
  }
  if (range) {
    headers.set("Range", range);
  }

  const playbackSessionId = useProviderAuth ? transcodeSessionId(handle.path) : null;
  if (playbackSessionId) {
    headers.set("X-Plex-Session-Identifier", playbackSessionId);
  }

  logger.trace("Fetching Plex media for handle {handleId}.", {
    handleId: handle.id,
    sessionId: session.id,
    sourceId: handle.sourceId,
    upstreamUrl: sanitizeLoggedMediaPath(url.toString()),
    useProviderAuth,
    hasRange: Boolean(range),
    accept,
    playbackSessionId,
  });

  await proxyProviderMediaResponse(
    session,
    handle,
    {
      accept: accept ?? undefined,
      range: range ?? undefined,
    },
    async () => {
      const upstream = await fetch(url.toString(), { headers });
      if (!upstream.ok && upstream.status !== 206) {
        const detail = (await upstream.text()).slice(0, 400).replace(/\s+/g, " ").trim();
        logger.warn("Plex media request failed for handle {handleId}.", {
          handleId: handle.id,
          sessionId: session.id,
          sourceId: handle.sourceId,
          upstreamUrl: sanitizeLoggedMediaPath(url.toString()),
          statusCode: upstream.status,
          detail,
          useProviderAuth,
          hasRange: Boolean(range),
          accept,
          playbackSessionId,
        });
        throw new ApiError(
          upstream.status,
          "plex_media_failed",
          detail ? `Plex media request failed: ${detail}` : "Plex media request failed"
        );
      }

      return upstream;
    },
    res,
  );
}
