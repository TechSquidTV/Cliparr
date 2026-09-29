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
  numberValue,
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
  isSelectedEntry,
  isVideoStream,
  itemTitleValue,
  itemTypeValue,
  metadataPath,
  playheadSecondsFromViewOffset,
  resolveSelectedPart,
  selectedAudioTrackTitle,
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
      const data = await fetchPmsCurrentSessions(context, {
        timeoutMs: CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
      });
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

async function normalizeCurrentPlayback(
  session: ProviderSessionRecord,
  source: MediaSource,
  context: PlexSourceContext,
  data: StatusGetSlashResponse,
): Promise<CurrentlyPlayingEntry[]> {
  const metadata = data?.MediaContainer?.Metadata;
  if (!Array.isArray(metadata)) {
    return [];
  }

  const uniqueMetadata = dedupeCurrentlyPlayingMetadata(metadata);
  const enrichedItems = await enrichPlaybackItems(context, uniqueMetadata);

  return uniqueMetadata.map((item, index) => {
    const { plexPlaybackSessionId, cliparrPreviewTranscodeSessionId } =
      derivePlexPlaybackIds(source.id, item);
    const mediaSelection = deriveMediaSelection(item);
    const enrichedItem = enrichedItems[index];
    const mediaPath = resolveMediaPath(item, enrichedItem, mediaSelection);
    const previewPath = createPreviewPath(
      enrichedItem,
      cliparrPreviewTranscodeSessionId,
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
      plexPlaybackSessionId,
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
          playbackSessionId: plexPlaybackSessionId,
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
      playbackSessionId: plexPlaybackSessionId,
      transcodeSessionId: cliparrPreviewTranscodeSessionId,
      currentlyPlayingItem: {
        id: `${source.id}:${plexPlaybackSessionId}`,
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
      viewer: playbackViewer(
        session,
        context,
        item,
        source.id,
        plexPlaybackSessionId,
      ),
      item: {
        id: `${source.id}:${plexPlaybackSessionId}`,
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
  });
}

export async function listCurrentlyPlaying(
  session: ProviderSessionRecord,
  source: MediaSource,
) {
  const { context, data } = await fetchCurrentlyPlayingData(source);
  return normalizeCurrentPlayback(session, source, context, data);
}
