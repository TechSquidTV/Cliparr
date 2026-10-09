import { createPlaybackResolverCache } from "@/playback/resolverCache";
import {
  logErrorFields,
  logEventFields,
  sanitizeUrlForLog,
} from "@cliparr/shared/logging";
import { parseExternalIds } from "@cliparr/shared/external-ids";
import type { MediaSource } from "@/db/mediaSourcesRepository";
import { getServerLogger, warnWithError } from "@/logging";
import type { ProviderSessionRecord } from "@/session/store";
import type {
  CurrentlyPlayingEntry,
  MediaExportMetadata,
} from "@/providers/types";
import { playlistBasePath } from "@/providers/shared/hlsPlaylist";
import { dedupeInflightFetch } from "@/providers/shared/inflight";
import { subtitleTrackSupportsBurnIn } from "@/providers/shared/subtitles";
import {
  asArray,
  buildEpisodeSourceTitle,
  normalizeRating,
  numberValue,
  stringValue,
  uniqueStrings,
} from "@/providers/shared/utilities";
import {
  fetchCurrentUser,
  fetchItem,
  fetchPlaybackInfo,
  fetchSessions,
  sourceContext,
  type JellyfinItem,
  type JellyfinPlaybackInfo,
  type JellyfinSessionInfo,
  type JellyfinSourceContext,
} from "@/providers/jellyfin/shared";
import {
  buildPreviewPath,
  buildStaticStreamPath,
  createJellyfinExportEstimateMetadata,
  currentMediaSource,
  currentMediaSourceId,
  deriveSelectedAudioTrack,
  isAudioMediaStream,
  isVideoMediaStream,
  normalizedString,
  selectedJellyfinAudioStreamIndex,
  ticksToSeconds,
} from "@/providers/jellyfin/selection";
import {
  deriveSelectedSubtitleTrack,
  deriveSubtitleTracks,
} from "@/providers/jellyfin/subtitles";
import { createMediaHandle } from "@/providers/jellyfin/mediaProxy";

const logger = getServerLogger(["provider", "jellyfin", "playback"]);

const HD_ARTWORK_SIZE = 1920;

const HD_ARTWORK_QUALITY = 96;

const PLAYBACK_INFO_CACHE_TTL_MS = 1000 * 60 * 15;

interface CachedPlaybackInfo {
  expiresAt: number;
  playbackInfo: JellyfinPlaybackInfo;
}

const playbackInfoCache = new Map<string, CachedPlaybackInfo>();

// In-flight upstream fetches, shared across concurrent callers so N sessions
// watching the same item trigger one fetch instead of N. Entries are removed
// as soon as they settle, so failures are retried on the next call.
const inflightItemFetches = new Map<string, Promise<JellyfinItem>>();

const inflightPlaybackInfoFetches = new Map<
  string,
  Promise<JellyfinPlaybackInfo>
>();

function itemFetchKey(context: JellyfinSourceContext, itemId: string) {
  return JSON.stringify([
    context.baseUrl,
    context.token,
    context.userId,
    context.deviceId,
    itemId,
  ]);
}

function fetchSharedItem(context: JellyfinSourceContext, itemId: string) {
  return dedupeInflightFetch(
    inflightItemFetches,
    itemFetchKey(context, itemId),
    () => fetchItem(context, itemId),
  );
}

export function playheadSecondsFromPositionTicks(value?: number | null) {
  if (value === null || value === undefined) {
    return;
  }

  const ticks = Number(value);
  if (!Number.isFinite(ticks) || ticks < 0) {
    return;
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

  return;
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
  const guids = providerGuids(item);

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
    guids,
    externalIds: parseExternalIds(guids),
    criticRating: normalizeRating(item?.CriticRating, 100),
    audienceRating: normalizeRating(item?.CommunityRating),
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
    const fullItem = await fetchSharedItem(context, itemId);
    return {
      ...item,
      ...fullItem,
    };
  } catch (error) {
    warnWithError(logger, error, "Could not fetch Jellyfin metadata.", {
      ...logErrorFields(error),
      "metadata.item.id": itemId,
      "source.id": context.sourceId,
      "source.base_url": sanitizeUrlForLog(context.baseUrl),
    });
    return item;
  }
}

async function loadPlaybackInfo(
  session: ProviderSessionRecord,
  context: JellyfinSourceContext,
  sessionInfo: JellyfinSessionInfo,
  itemId: string,
  requirePlayable = false,
) {
  const cacheKey = playbackInfoCacheKey(session, context, sessionInfo, itemId);
  const cached = playbackInfoCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    cached.expiresAt = now + PLAYBACK_INFO_CACHE_TTL_MS;
    return cached.playbackInfo;
  }

  prunePlaybackInfoCache(now);

  try {
    const playbackInfo = await dedupeInflightFetch(
      inflightPlaybackInfoFetches,
      JSON.stringify([cacheKey, itemFetchKey(context, itemId)]),
      () => fetchPlaybackInfo(context, itemId),
    );
    if (requirePlayable && !stringValue(playbackInfo?.PlaySessionId)) {
      throw new Error("Jellyfin returned no playback session");
    }
    if (stringValue(playbackInfo?.PlaySessionId)) {
      playbackInfoCache.set(cacheKey, {
        expiresAt: Date.now() + PLAYBACK_INFO_CACHE_TTL_MS,
        playbackInfo,
      });
    }
    return playbackInfo;
  } catch (error) {
    if (requirePlayable) {
      throw error;
    }
    warnWithError(logger, error, "Could not fetch Jellyfin playback info.", {
      ...logErrorFields(error),
      "metadata.item.id": itemId,
      "source.id": context.sourceId,
      "source.base_url": sanitizeUrlForLog(context.baseUrl),
    });
    return;
  }
}

function playbackInfoCacheKey(
  session: ProviderSessionRecord,
  context: JellyfinSourceContext,
  sessionInfo: JellyfinSessionInfo,
  itemId: string,
) {
  return [
    session.id,
    context.sourceId,
    stringValue(sessionInfo?.Id) ?? "unknown-session",
    itemId,
    stringValue(sessionInfo?.PlayState?.MediaSourceId) ??
      "unknown-media-source",
  ].join(":");
}

function prunePlaybackInfoCache(now = Date.now()) {
  for (const [cacheKey, cached] of playbackInfoCache.entries()) {
    if (cached.expiresAt <= now) {
      playbackInfoCache.delete(cacheKey);
    }
  }
}

function playbackItemIdentity(
  sourceId: string,
  jellyfinClientSessionId: string | undefined,
  itemId: string,
  mediaSourceId: string | undefined,
) {
  return [
    sourceId,
    jellyfinClientSessionId ?? "unknown-session",
    itemId,
    mediaSourceId ?? "unknown-media-source",
  ].join(":");
}

function playbackViewer(
  sourceId: string,
  jellyfinClientSessionId: string,
  sessionInfo: JellyfinSessionInfo,
) {
  const externalId = stringValue(sessionInfo?.UserId);
  return {
    id: externalId
      ? `jellyfin:user:${externalId}`
      : `jellyfin:synthetic:${sourceId}:${jellyfinClientSessionId}`,
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
  preparedItem?: JellyfinItem,
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
    preparedItem ?? enrichMetadataItem(context, nowPlayingItem),
    loadPlaybackInfo(
      session,
      context,
      sessionInfo,
      itemId,
      Boolean(preparedItem),
    ),
  ]);
  const jellyfinPlaySessionId = stringValue(playbackInfo?.PlaySessionId);
  const jellyfinClientSessionId = stringValue(sessionInfo?.Id);
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
  const audioStreamIndex = selectedJellyfinAudioStreamIndex(
    sessionInfo,
    mediaSource,
  );
  const mediaPath = jellyfinPlaySessionId
    ? buildStaticStreamPath(
        enrichedItem,
        mediaSourceId,
        context,
        jellyfinPlaySessionId,
      )
    : undefined;
  const previewPath = jellyfinPlaySessionId
    ? buildPreviewPath(
        enrichedItem,
        mediaSourceId,
        context,
        jellyfinPlaySessionId,
        audioStreamIndex,
      )
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
  const exportEstimateMetadata = mediaSource
    ? createJellyfinExportEstimateMetadata(mediaSource, duration)
    : undefined;
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
    jellyfinClientSessionId,
    itemId,
    mediaSourceId,
  );
  const missingPreviewPath =
    !previewPath && normalizedString(enrichedItem?.MediaType) !== "audio";
  const unresolvedSelectedAudioTrack =
    !selectedAudioTrack && audioStreams.length > 1;
  logger.trace("Resolved Jellyfin playback item.", {
    ...logEventFields("provider.playback.resolve", "success"),
    "provider.id": "jellyfin",
    "session.id": session.id,
    "source.id": source.id,
    "provider.account.id": source.providerAccountId,
    "jellyfin.play_session.id": jellyfinPlaySessionId,
    "media.item.id": playbackItemId,
    "media.source.id": mediaSourceId,
    "media.video_stream.count": videoStreams.length,
    "media.audio_stream.count": audioStreams.length,
    "media.preview.missing": missingPreviewPath,
    "media.audio_selection.unresolved": unresolvedSelectedAudioTrack,
    "media.audio_stream.index": numberValue(
      sessionInfo?.PlayState?.AudioStreamIndex,
    ),
    "media.audio_stream.default_index": numberValue(
      mediaSource?.DefaultAudioStreamIndex,
    ),
  });

  return {
    viewer: playbackViewer(
      source.id,
      jellyfinClientSessionId ?? itemId,
      sessionInfo,
    ),
    item: {
      id: playbackItemId,
      playbackSessionId: jellyfinClientSessionId,
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
      exportEstimateMetadata,
    },
  } satisfies CurrentlyPlayingEntry;
}

export function sourceSupportsCurrentlyPlaying(source: MediaSource) {
  return Boolean(stringValue(source.credentials.accessToken));
}

export async function listCurrentlyPlaying(
  session: ProviderSessionRecord,
  source: MediaSource,
) {
  const context = sourceContext(source);
  // Recheck permissions because the stored role can outlive an account change.
  const [currentUser, sessions] = await Promise.all([
    fetchCurrentUser(context),
    fetchSessions(context),
  ]);
  const isAdministrator = currentUser?.Policy?.IsAdministrator === true;
  return resolveJellyfinPlayback(
    session,
    source,
    context,
    sessions,
    isAdministrator,
  );
}

export function visibleJellyfinSessions(
  sessions: JellyfinSessionInfo[],
  userId: string,
  isAdministrator: boolean,
) {
  return sessions.filter(
    (session) =>
      Boolean(stringValue(session.NowPlayingItem?.Id)) &&
      (isAdministrator || session.UserId === userId),
  );
}

export function jellyfinPlaybackIdentity(sessions: JellyfinSessionInfo[]) {
  return JSON.stringify(
    sessions
      .toSorted((a, b) => (a.Id ?? "").localeCompare(b.Id ?? ""))
      .map((session) => [
        session.Id,
        session.UserId,
        session.UserName,
        session.Client,
        session.DeviceName,
        session.NowPlayingItem?.Id,
        session.NowPlayingItem?.Name,
        session.NowPlayingItem?.ImageTags,
        session.PlayState?.MediaSourceId,
        session.PlayState?.AudioStreamIndex,
        session.PlayState?.SubtitleStreamIndex,
      ]),
  );
}

export function createJellyfinPlaybackResolver(
  source: MediaSource,
  context: JellyfinSourceContext,
) {
  return createPlaybackResolverCache({
    key: (row: JellyfinSessionInfo) => jellyfinPlaybackIdentity([row]),
    prepareMany: (rows) =>
      Promise.all(
        rows.map(async (row) => {
          const id = stringValue(row.NowPlayingItem?.Id);
          if (!id) {
            throw new Error("Jellyfin session has no item ID");
          }
          return {
            ...row.NowPlayingItem,
            ...(await fetchSharedItem(context, id)),
          };
        }),
      ),
    bind: (row, item, session) =>
      normalizeCurrentPlayback(session, source, context, row, item),
    update: (entry, row) => ({
      ...entry,
      item: {
        ...entry.item,
        playerState: row.PlayState?.IsPaused ? "paused" : "playing",
        playheadSeconds: playheadSecondsFromPositionTicks(
          row.PlayState?.PositionTicks,
        ),
      },
    }),
  });
}

async function resolveJellyfinPlayback(
  session: ProviderSessionRecord,
  source: MediaSource,
  context: JellyfinSourceContext,
  sessions: JellyfinSessionInfo[],
  isAdministrator: boolean,
) {
  const activeSessions = visibleJellyfinSessions(
    sessions,
    context.userId,
    isAdministrator,
  );
  const entries = await Promise.all(
    activeSessions.map((sessionInfo) =>
      normalizeCurrentPlayback(session, source, context, sessionInfo),
    ),
  );

  return entries.filter(
    (entry): entry is CurrentlyPlayingEntry => entry !== undefined,
  );
}
