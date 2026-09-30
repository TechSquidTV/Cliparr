import { createPlaybackResolverCache } from "@/playback/resolverCache";
import { logEventFields } from "@cliparr/shared/logging";
import { randomUUID } from "node:crypto";
import {
  updateMediaSource,
  type MediaSource,
} from "@/db/mediaSourcesRepository";
import { createApiError, isApiError } from "@/http/errors";
import { getServerLogger } from "@/logging";
import type { ProviderSessionRecord } from "@/session/store";
import type { StatusGetSlashResponse } from "@cliparr/plex/pms/types";
import type {
  CurrentlyPlayingEntry,
  ProviderConnection,
  ProviderResource,
} from "@/providers/types";
import {
  asArray,
  errorMessage,
  stringValue,
} from "@/providers/shared/utilities";
import {
  buildSourceContext,
  candidateConnections,
  CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
  fetchPmsCurrentSessions,
  sourceResource,
  unreachableConnectionMessage,
  type PlexSourceContext,
} from "@/providers/plex/shared";
import {
  PLEX_BASE_URL_MODE_AUTO,
  PLEX_BASE_URL_MODE_MANUAL,
  withPlexBaseUrlMode,
  type PlexBaseUrlMode,
} from "@/providers/plex/connectionState";
import type {
  PlexMediaSelection,
  PlexMetadataItem,
  PlexPart,
} from "@/providers/plex/selection";
import {
  createCliparrPlexTranscodeSessionId,
  createPlexExportEstimateMetadata,
  createPreviewPath,
  deriveMediaSelection,
  deriveSelectedAudioTrack,
  idValue,
  isAudioStream,
  isVideoStream,
  itemTitleValue,
  itemTypeValue,
  metadataPath,
  playheadSecondsFromViewOffset,
  resolveSelectedPart,
  streamEntries,
} from "@/providers/plex/selection";
import { createMediaHandle } from "@/providers/plex/mediaHandles";
import {
  createExportMetadata,
  enrichPlaybackItems,
  metadataImagePath,
} from "@/providers/plex/metadata";
import {
  deriveSelectedSubtitleTrack,
  deriveSubtitleTracks,
  subtitleTrackSupportsBurnIn,
} from "@/providers/plex/subtitles";

const logger = getServerLogger(["provider", "plex", "playback"]);

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

export async function fetchCurrentlyPlayingData(
  source: MediaSource,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
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
      const data = await fetchPmsCurrentSessions(context, {
        timeoutMs: CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
        signal,
      });
      signal?.throwIfAborted();
      persistWorkingSourceConnection(source, persistedConnections, connection, {
        baseUrlMode,
        manualConnectionId,
      });
      return { context, data };
    } catch (error) {
      signal?.throwIfAborted();
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

function returnedPartPath(part: PlexPart | undefined) {
  return stringValue(part?.key);
}

function resolveMediaPath(
  item: PlexMetadataItem,
  enrichedItem: PlexMetadataItem,
  selection?: PlexMediaSelection,
) {
  return (
    returnedPartPath(resolveSelectedPart(item, selection)?.part) ??
    returnedPartPath(resolveSelectedPart(enrichedItem, selection)?.part)
  );
}

function playbackSessionIdentity(item: PlexMetadataItem) {
  return String(
    item?.sessionKey ??
      item?.Session?.id ??
      playbackFallbackIdentity(item) ??
      randomUUID(),
  );
}

function derivePlexPlaybackIds(sourceId: string, item: PlexMetadataItem) {
  const plexPlaybackSessionId = playbackSessionIdentity(item);

  return {
    plexPlaybackSessionId,
    cliparrPreviewTranscodeSessionId: createCliparrPlexTranscodeSessionId(
      sourceId,
      plexPlaybackSessionId,
    ),
  };
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
  plexPlaybackSessionId: string,
) {
  const externalId = stringValue(item?.User?.id);
  return {
    id: externalId
      ? `plex:user:${externalId}`
      : `plex:synthetic:${sourceId}:${plexPlaybackSessionId}`,
    providerId: "plex" as const,
    externalId,
    name: stringValue(item?.User?.title) ?? "Unknown User",
    avatarUrl: createPlexViewerAvatarUrl(session, context, item),
  };
}

async function preparePlexPlayback(
  context: PlexSourceContext,
  item: PlexMetadataItem,
) {
  const [prepared] = await enrichPlaybackItems(context, [item], {
    required: true,
  });
  return prepared;
}

function bindPlexPlayback(
  session: ProviderSessionRecord,
  source: MediaSource,
  context: PlexSourceContext,
  item: PlexMetadataItem,
  prepared: Awaited<ReturnType<typeof preparePlexPlayback>>,
): CurrentlyPlayingEntry {
  const { plexPlaybackSessionId, cliparrPreviewTranscodeSessionId } =
    derivePlexPlaybackIds(source.id, item);
  const mediaSelection = deriveMediaSelection(item);
  const { item: enrichedItem, libraryItem } = prepared;
  const mediaPath = resolveMediaPath(item, enrichedItem, mediaSelection);
  const previewPath = createPreviewPath(
    enrichedItem,
    cliparrPreviewTranscodeSessionId,
    mediaSelection,
  );
  const thumbPath = metadataImagePath(enrichedItem);
  const selectedPart = resolveSelectedPart(enrichedItem, mediaSelection)?.part;
  // A retained live file still needs its own audio selection even when that
  // version is missing from the library response used for preview indexes.
  const audioItem = !selectedPart && mediaPath ? item : enrichedItem;
  const selectedAudioTrack = deriveSelectedAudioTrack(
    audioItem,
    mediaSelection,
    libraryItem,
  );
  const selectedSubtitleTrack = deriveSelectedSubtitleTrack(
    enrichedItem,
    mediaSelection,
  );
  const subtitleTracks = deriveSubtitleTracks(
    session,
    context,
    enrichedItem,
    plexPlaybackSessionId,
    mediaSelection,
  ).filter((track) => subtitleTrackSupportsBurnIn(track));
  const audioStreams = streamEntries(
    resolveSelectedPart(audioItem, mediaSelection)?.part,
  ).filter((stream) => isAudioStream(stream));
  const videoStreams = selectedPart
    ? streamEntries(selectedPart).filter((stream) => isVideoStream(stream))
    : [];
  const duration =
    Number(
      enrichedItem.duration ?? asArray(enrichedItem.Media)[0]?.duration ?? 0,
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
        generatedOperation: true,
        playbackSessionId: plexPlaybackSessionId,
      })
    : undefined;
  const missingPreviewPath =
    !previewPath && itemTypeValue(enrichedItem) !== "track";
  const unresolvedSelectedAudioTrack =
    !selectedAudioTrack && audioStreams.length > 1;
  logger.trace("Resolved Plex playback item.", {
    ...logEventFields("provider.playback.resolve", "success"),
    "provider.id": "plex",
    "session.id": session.id,
    "source.id": source.id,
    "provider.account.id": source.providerAccountId,
    "plex.playback_session.id": plexPlaybackSessionId,
    "plex.transcode_session.id": cliparrPreviewTranscodeSessionId,
    "media.item.id": `${source.id}:${plexPlaybackSessionId}`,
    "media.id": mediaSelection?.mediaId,
    "media.index": mediaSelection?.mediaIndex,
    "media.part.id": mediaSelection?.partId,
    "media.part.index": mediaSelection?.partIndex,
    "media.video_stream.count": videoStreams.length,
    "media.audio_stream.count": audioStreams.length,
    "media.preview.missing": missingPreviewPath,
    "media.audio_selection.unresolved": unresolvedSelectedAudioTrack,
  });

  return {
    viewer: playbackViewer(
      session,
      context,
      item,
      source.id,
      plexPlaybackSessionId,
    ),
    item: {
      id: `${source.id}:${plexPlaybackSessionId}`,
      playbackSessionId: plexPlaybackSessionId,
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
}

export function createPlexPlaybackResolver(
  source: MediaSource,
  context: PlexSourceContext,
) {
  const resolve = createPlaybackResolverCache({
    key: (item: PlexMetadataItem) =>
      JSON.stringify([
        playbackSessionIdentity(item),
        item.ratingKey,
        item.key,
        item.title,
        item.thumb,
        item.User,
        item.Player?.title,
        item.Player?.machineIdentifier,
        item.Media,
      ]),
    prepare: (item) => preparePlexPlayback(context, item),
    bind: async (item, prepared, session) =>
      bindPlexPlayback(session, source, context, item, prepared),
    update: (entry, item) => ({
      ...entry,
      item: {
        ...entry.item,
        playerState: stringValue(item.Player?.state) ?? "unknown",
        playheadSeconds: playheadSecondsFromViewOffset(item.viewOffset),
      },
    }),
  });
  return (data: StatusGetSlashResponse) =>
    resolve(
      dedupeCurrentlyPlayingMetadata(data.MediaContainer?.Metadata ?? []),
    );
}

async function normalizeCurrentPlayback(
  session: ProviderSessionRecord,
  source: MediaSource,
  context: PlexSourceContext,
  data: StatusGetSlashResponse,
): Promise<CurrentlyPlayingEntry[]> {
  const items = dedupeCurrentlyPlayingMetadata(
    data.MediaContainer?.Metadata ?? [],
  );
  const prepared = await enrichPlaybackItems(context, items);
  return items.map((item, index) =>
    bindPlexPlayback(session, source, context, item, prepared[index]),
  );
}

export async function listCurrentlyPlaying(
  session: ProviderSessionRecord,
  source: MediaSource,
) {
  const { context, data } = await fetchCurrentlyPlayingData(source);
  return normalizeCurrentPlayback(session, source, context, data);
}
