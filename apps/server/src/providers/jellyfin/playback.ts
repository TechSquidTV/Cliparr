import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import type { MediaSource } from "../../db/mediaSourcesRepository.js";
import { ApiError } from "../../http/errors.js";
import { getServerLogger } from "../../logging.js";
import type { ProviderSessionRecord } from "../../session/store.js";
import type {
  CurrentlyPlayingEntry,
  MediaExportMetadata,
  PlaybackAudioSelection,
} from "../types.js";
import {
  createProviderMediaHandle,
  mediaHandleRequestUrl,
  playlistBasePath,
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
  booleanValue,
  fetchItem,
  fetchSessions,
  jellyfinFetch,
  jellyfinHeaders,
  JELLYFIN_REQUEST_TIMEOUT_MS,
  sourceContext,
  type JellyfinSourceContext,
} from "./shared.js";

const logger = getServerLogger(["providers", "jellyfin"]);

function createMediaHandle(
  session: ProviderSessionRecord,
  context: JellyfinSourceContext,
  path: string,
  options: { basePath?: string } = {}
) {
  return createProviderMediaHandle(session, {
    providerId: "jellyfin",
    sourceId: context.sourceId,
    baseUrl: context.baseUrl,
    token: context.token,
    deviceId: context.deviceId,
  }, path, options);
}

function ticksToSeconds(value: unknown) {
  const ticks = Number(value);
  if (!Number.isFinite(ticks) || ticks <= 0) {
    return 0;
  }

  return ticks / 10_000_000;
}

function itemType(item: any) {
  return stringValue(item?.Type) ?? stringValue(item?.MediaType) ?? "Video";
}

function itemTitle(item: any) {
  return stringValue(item?.Name) ?? stringValue(item?.EpisodeTitle) ?? "Untitled";
}

function buildSourceTitle(item: any) {
  const title = itemTitle(item);
  if (itemType(item) !== "Episode") {
    return title;
  }

  return buildEpisodeSourceTitle({
    title,
    seriesTitle: stringValue(item?.SeriesName),
    seasonNumber: numberValue(item?.ParentIndexNumber),
    episodeNumber: numberValue(item?.IndexNumber),
  }) ?? title;
}

function itemImagePath(item: any) {
  const itemId = stringValue(item?.Id);
  const imageTags = item?.ImageTags ?? {};

  if (itemType(item) === "Episode") {
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

function currentMediaSourceId(sessionInfo: any, item: any) {
  return stringValue(sessionInfo?.PlayState?.MediaSourceId)
    ?? stringValue(asArray(item?.MediaSources)[0]?.Id)
    ?? stringValue(asArray(sessionInfo?.NowPlayingItem?.MediaSources)[0]?.Id);
}

function currentMediaSource(sessionInfo: any, item: any, mediaSourceId: string | undefined) {
  const itemMediaSources = asArray(item?.MediaSources);
  const sessionMediaSources = asArray(sessionInfo?.NowPlayingItem?.MediaSources);
  const mediaSources = [...itemMediaSources, ...sessionMediaSources];

  if (mediaSourceId) {
    const matchingMediaSource = mediaSources.find((mediaSource) => stringValue(mediaSource?.Id) === mediaSourceId);
    if (matchingMediaSource) {
      return matchingMediaSource;
    }
  }

  return mediaSources[0];
}

function isAudioMediaStream(stream: any) {
  return String(stream?.Type ?? "").toLowerCase() === "audio";
}

function jellyfinAudioTrackTitle(stream: any) {
  return stringValue(stream?.Title)
    ?? stringValue(stream?.DisplayTitle);
}

function deriveSelectedAudioTrack(
  sessionInfo: any,
  item: any,
  mediaSourceId: string | undefined
): PlaybackAudioSelection | undefined {
  const mediaSource = currentMediaSource(sessionInfo, item, mediaSourceId);
  if (!mediaSource) {
    return undefined;
  }

  const audioStreams = asArray(mediaSource?.MediaStreams).filter((stream) => isAudioMediaStream(stream));
  if (audioStreams.length === 0) {
    return undefined;
  }

  const selectedAudioStreamIndex = numberValue(sessionInfo?.PlayState?.AudioStreamIndex)
    ?? numberValue(mediaSource?.DefaultAudioStreamIndex);

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
    (stream) => numberValue(stream?.Index) === selectedAudioStreamIndex
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

function buildStaticStreamPath(
  item: any,
  mediaSourceId: string | undefined,
  context: JellyfinSourceContext,
  playSessionId: string
) {
  const itemId = stringValue(item?.Id);
  if (!itemId) {
    return undefined;
  }

  const isAudio = String(item?.MediaType ?? "").toLowerCase() === "audio";
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

function buildPreviewPath(
  item: any,
  mediaSourceId: string | undefined,
  context: JellyfinSourceContext,
  playSessionId: string
) {
  const itemId = stringValue(item?.Id);
  if (!itemId || String(item?.MediaType ?? "").toLowerCase() === "audio" || !mediaSourceId) {
    return undefined;
  }

  const params = new URLSearchParams({
    mediaSourceId,
    deviceId: context.deviceId,
    playSessionId,
    maxAudioChannels: "2",
    audioCodec: "aac",
    enableAdaptiveBitrateStreaming: "false",
  });

  return `/Videos/${encodeURIComponent(itemId)}/master.m3u8?${params.toString()}`;
}

function peopleNames(item: any, kind: string) {
  return uniqueStrings(
    asArray(item?.People).flatMap((person: any) => {
      if (stringValue(person?.Type) !== kind) {
        return [];
      }

      const name = stringValue(person?.Name);
      return name ? [name] : [];
    })
  );
}

function studios(item: any) {
  return uniqueStrings(
    asArray(item?.Studios).map((entry: any) => stringValue(entry?.Name) ?? stringValue(entry?.name))
  );
}

function providerGuids(item: any) {
  const providerIds = item?.ProviderIds;
  if (!providerIds || typeof providerIds !== "object" || Array.isArray(providerIds)) {
    return [];
  }

  return uniqueStrings(
    Object.entries(providerIds as Record<string, unknown>).map(([provider, id]) => {
      const normalizedId = stringValue(id);
      return normalizedId ? `${provider.toLowerCase()}://${normalizedId}` : undefined;
    })
  );
}

function firstTagline(item: any) {
  return uniqueStrings(asArray(item?.Taglines).map((value) => stringValue(value)))[0];
}

function createExportMetadata(
  session: ProviderSessionRecord,
  context: JellyfinSourceContext,
  item: any
): MediaExportMetadata {
  const imagePath = itemImagePath(item);

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
    genres: uniqueStrings(asArray(item?.Genres).map((value) => stringValue(value))),
    directors: peopleNames(item, "Director"),
    writers: uniqueStrings([...peopleNames(item, "Writer"), ...peopleNames(item, "Author")]),
    actors: uniqueStrings([
      ...peopleNames(item, "Actor"),
      ...peopleNames(item, "GuestStar"),
      ...peopleNames(item, "Artist"),
    ]).slice(0, 12),
    guids: providerGuids(item),
    ratingKey: stringValue(item?.Id),
    imageUrl: imagePath ? createMediaHandle(session, context, imagePath) : undefined,
  };
}

async function enrichMetadataItem(context: JellyfinSourceContext, item: any) {
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
    logger.warn("Could not fetch Jellyfin metadata for item {itemId}.", {
      itemId,
      sourceId: context.sourceId,
      baseUrl: context.baseUrl,
      errorMessage: errorMessage(err),
    });
    return item;
  }
}

function playbackViewer(sourceId: string, sessionId: string, sessionInfo: any) {
  const externalId = stringValue(sessionInfo?.UserId);
  return {
    id: externalId ? `jellyfin:user:${externalId}` : `jellyfin:synthetic:${sourceId}:${sessionId}`,
    providerId: "jellyfin" as const,
    externalId,
    name: stringValue(sessionInfo?.UserName) ?? "Unknown User",
  };
}

async function normalizeCurrentPlayback(
  session: ProviderSessionRecord,
  source: MediaSource,
  context: JellyfinSourceContext,
  sessionInfo: any
): Promise<CurrentlyPlayingEntry | undefined> {
  const nowPlayingItem = sessionInfo?.NowPlayingItem;
  const itemId = stringValue(nowPlayingItem?.Id);
  if (!itemId) {
    return undefined;
  }

  const enrichedItem = await enrichMetadataItem(context, nowPlayingItem);
  const playSessionId = stringValue(sessionInfo?.Id) ?? randomUUID();
  const mediaSourceId = currentMediaSourceId(sessionInfo, enrichedItem);
  const mediaPath = buildStaticStreamPath(enrichedItem, mediaSourceId, context, playSessionId);
  const previewPath = buildPreviewPath(enrichedItem, mediaSourceId, context, playSessionId);
  const imagePath = itemImagePath(enrichedItem);
  const selectedAudioTrack = deriveSelectedAudioTrack(sessionInfo, enrichedItem, mediaSourceId);
  const playerState = sessionInfo?.PlayState?.IsPaused ? "paused" : "playing";

  return {
    viewer: playbackViewer(source.id, playSessionId, sessionInfo),
    item: {
      id: `${source.id}:${playSessionId}`,
      source: {
        id: source.id,
        name: source.name,
        providerId: "jellyfin",
      },
      title: itemTitle(enrichedItem),
      type: itemType(enrichedItem).toLowerCase(),
      duration: ticksToSeconds(enrichedItem?.RunTimeTicks ?? nowPlayingItem?.RunTimeTicks),
      playerTitle: stringValue(sessionInfo?.DeviceName)
        ?? stringValue(sessionInfo?.Client)
        ?? stringValue(sessionInfo?.DeviceType)
        ?? "Unknown Device",
      playerState,
      thumbUrl: imagePath ? createMediaHandle(session, context, imagePath) : undefined,
      mediaUrl: mediaPath ? createMediaHandle(session, context, mediaPath) : undefined,
      hlsUrl: previewPath
        ? createMediaHandle(session, context, previewPath, { basePath: playlistBasePath(previewPath) })
        : undefined,
      selectedAudioTrack,
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

export async function listCurrentlyPlaying(session: ProviderSessionRecord, source: MediaSource) {
  const context = sourceContext(source);
  const sessions = await fetchSessions(context);
  const activeSessions = sessions.filter((sessionInfo) => Boolean(stringValue(sessionInfo?.NowPlayingItem?.Id)));
  const entries = await Promise.all(
    activeSessions.map((sessionInfo) => normalizeCurrentPlayback(session, source, context, sessionInfo))
  );

  return entries.filter((entry): entry is CurrentlyPlayingEntry => Boolean(entry));
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

  const accept = req.header("accept") ?? undefined;
  const useProviderAuth = shouldAttachProviderAuth(handle);
  const headers = useProviderAuth
    ? jellyfinHeaders({
        token: handle.token,
        deviceId: handle.deviceId,
        accept,
      })
    : new Headers(accept ? { Accept: accept } : undefined);
  const range = req.header("range");
  if (range) {
    headers.set("Range", range);
  }

  const upstreamUrl = mediaHandleRequestUrl(handle).toString();

  logger.debug("Fetching Jellyfin media for handle {handleId}.", {
    handleId: handle.id,
    sessionId: session.id,
    sourceId: handle.sourceId,
    upstreamUrl: sanitizeLoggedMediaPath(upstreamUrl),
    useProviderAuth,
    hasRange: Boolean(range),
    accept,
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
        if (!useProviderAuth) {
          const upstream = await fetch(upstreamUrl, {
            headers,
            signal: AbortSignal.timeout(JELLYFIN_REQUEST_TIMEOUT_MS),
          });

          if (!upstream.ok && upstream.status !== 206) {
            const detail = (await upstream.text()).slice(0, 400).replace(/\s+/g, " ").trim();
            throw new ApiError(
              upstream.status,
              "jellyfin_media_failed",
              detail ? `Jellyfin media request failed: ${detail}` : "Jellyfin media request failed",
            );
          }

          return upstream;
        }

        return await jellyfinFetch(upstreamUrl, {
          headers,
        }, {
          token: handle.token,
          deviceId: handle.deviceId,
          accept,
          timeoutMs: JELLYFIN_REQUEST_TIMEOUT_MS,
          errorCode: "jellyfin_media_failed",
          failureMessage: "Jellyfin media request failed",
        });
      } catch (err) {
        logger.warn("Jellyfin media request failed for handle {handleId}.", {
          handleId: handle.id,
          sessionId: session.id,
          sourceId: handle.sourceId,
          upstreamUrl: sanitizeLoggedMediaPath(upstreamUrl),
          useProviderAuth,
          hasRange: Boolean(range),
          accept,
          errorMessage: errorMessage(err),
        });
        throw err;
      }
    },
    res,
  );
}
