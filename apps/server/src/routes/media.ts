import { randomUUID } from "node:crypto";
import { Router } from "express";
import {
  compactLogFields,
  logDurationFields,
  logErrorFields,
  logEventFields,
} from "@cliparr/shared/logging";
import { listMediaSources } from "@/db/mediaSourcesRepository";
import { asyncHandler, createApiError, isApiError } from "@/http/errors";
import { getServerLogger, warnWithError } from "@/logging";
import { getProvider } from "@/providers/registry";
import {
  assertAllowedMediaHandleRequestUrl,
  fetchMediaHandleRequest,
  mediaHandleRequestUrl,
  proxyProviderMediaResponse,
  sanitizeLoggedMediaPath,
  shouldForwardMediaRange,
} from "@/providers/shared/mediaProxy";
import type {
  CurrentlyPlayingEntry,
  MediaHandle,
  SourcePlaybackError,
  ViewerPlaybackGroup,
} from "@/providers/types";
import { requireAccountSession, setNoStore } from "@/session/request";
import {
  pruneSessionMediaHandles,
  type ProviderSessionRecord,
} from "@/session/store";

export const mediaRouter = Router();
const mediaLogger = getServerLogger("media");
const localUrlLogger = mediaLogger.getChild("local_url");
const discoveryLogger = mediaLogger.getChild("discovery");
const proxyLogger = mediaLogger.getChild("proxy");
const LOCAL_URL_PROVIDER_ID = "local-url";
const LOCAL_URL_SOURCE_ID = "remote-url";
const LOCAL_URL_MEDIA_BASE_URL = "http://cliparr.local";
const HLS_PLAYLIST_PATTERN = /\.m3u8(?:$|[#?])/i;
const localUrlMediaHandles = new Map<string, MediaHandle>();
const localUrlSession: ProviderSessionRecord = {
  id: "local-url",
  providerId: LOCAL_URL_PROVIDER_ID,
  providerAccountId: LOCAL_URL_SOURCE_ID,
  userToken: "",
  mediaHandles: localUrlMediaHandles,
  createdAt: 0,
  expiresAt: Number.MAX_SAFE_INTEGER,
};

function compareStrings(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function groupCurrentPlayback(
  entries: CurrentlyPlayingEntry[],
): ViewerPlaybackGroup[] {
  const groups = new Map<string, ViewerPlaybackGroup>();

  for (const entry of entries) {
    const existingGroup = groups.get(entry.viewer.id);
    if (existingGroup) {
      existingGroup.items.push(entry.item);
      continue;
    }

    groups.set(entry.viewer.id, {
      viewer: entry.viewer,
      items: [entry.item],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: group.items.toSorted(
        (left, right) =>
          compareStrings(left.source.name, right.source.name) ||
          compareStrings(left.playerTitle, right.playerTitle) ||
          compareStrings(left.title, right.title) ||
          compareStrings(left.id, right.id),
      ),
    }))
    .toSorted(
      (left, right) =>
        compareStrings(left.viewer.name, right.viewer.name) ||
        compareStrings(left.viewer.id, right.viewer.id),
    );
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

function bodyUrl(value: unknown) {
  const body =
    value && typeof value === "object" ? (value as { url?: unknown }) : null;
  if (typeof body?.url !== "string") {
    throw createApiError(
      400,
      "local_media_url_invalid",
      "Media URL is required",
    );
  }

  return body.url;
}

function parseLocalMediaUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw createApiError(
      400,
      "local_media_url_invalid",
      "Media URL is required",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw createApiError(
      400,
      "local_media_url_invalid",
      "Enter a valid absolute media URL",
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw createApiError(
      400,
      "local_media_url_invalid",
      "Media URL must use HTTP or HTTPS",
    );
  }

  return parsed;
}

function localUrlMediaPath(handleId: string) {
  return `/api/media/local-url/${handleId}`;
}

function isHlsPlaylistUrl(url: string) {
  return HLS_PLAYLIST_PATTERN.test(url);
}

function buildLocalUrlMediaHandle(
  value: string,
  basePath?: string,
): MediaHandle {
  const url = parseLocalMediaUrl(value);

  return {
    id: randomUUID(),
    providerId: LOCAL_URL_PROVIDER_ID,
    sourceId: LOCAL_URL_SOURCE_ID,
    baseUrl: LOCAL_URL_MEDIA_BASE_URL,
    path: url.toString(),
    token: "",
    basePath,
    lastAccessedAt: Date.now(),
  };
}

function storeLocalUrlMediaHandle(handle: MediaHandle) {
  localUrlMediaHandles.set(handle.id, handle);
  return localUrlMediaPath(handle.id);
}

function createLocalUrlMediaHandleUrl(
  _session: ProviderSessionRecord,
  _handle: MediaHandle,
  nextPath: string,
  basePath: string,
) {
  return storeLocalUrlMediaHandle(buildLocalUrlMediaHandle(nextPath, basePath));
}

mediaRouter.post(
  "/local-url",
  asyncHandler(async (request, res) => {
    setNoStore(res);
    const startedAt = Date.now();

    try {
      const prunedCount = pruneSessionMediaHandles(localUrlSession);
      const handle = buildLocalUrlMediaHandle(bodyUrl(request.body));
      await assertAllowedMediaHandleRequestUrl(handle);
      const mediaUrl = storeLocalUrlMediaHandle(handle);

      localUrlLogger.trace("Created local URL media handle.", {
        ...logEventFields("media.local_url.handle", "created"),
        "media.handle.id": handle.id,
        "upstream.url": sanitizeLoggedMediaPath(handle.path),
        "media.hls": isHlsPlaylistUrl(handle.path),
      });

      res.status(201).json({
        mediaUrl,
        hls: isHlsPlaylistUrl(handle.path),
      });

      localUrlLogger.info("Local URL media handle created.", {
        ...logEventFields("media.local_url.create", "success"),
        ...logDurationFields(startedAt),
        "media.handle.id": handle.id,
        "upstream.url": sanitizeLoggedMediaPath(handle.path),
        "media.hls": isHlsPlaylistUrl(handle.path),
        "media.handle.pruned_count": prunedCount,
      });
    } catch (error) {
      warnWithError(
        localUrlLogger,
        error,
        "Local URL media handle creation failed.",
        compactLogFields({
          ...logEventFields("media.local_url.create", "failure"),
          ...logDurationFields(startedAt),
          ...logErrorFields(error),
          "http.status_code": isApiError(error) ? error.status : undefined,
        }),
      );
      throw error;
    }
  }),
);

mediaRouter.get(
  "/local-url/:handleId",
  asyncHandler(async (request, res) => {
    setNoStore(res);
    const prunedCount = pruneSessionMediaHandles(localUrlSession);
    const handle = localUrlMediaHandles.get(request.params.handleId as string);
    if (!handle) {
      throw createApiError(
        404,
        "local_media_url_not_found",
        "URL media handle was not found or has expired",
      );
    }

    handle.lastAccessedAt = Date.now();

    const accept = request.header("accept") ?? undefined;
    const requestedRange = request.header("range") ?? undefined;
    const range = shouldForwardMediaRange(handle, requestedRange);
    const headers = new Headers(accept ? { Accept: accept } : undefined);
    if (range) {
      headers.set("Range", range);
    }

    const upstreamUrl = mediaHandleRequestUrl(handle).toString();
    localUrlLogger.trace("Fetching local URL media.", {
      "media.handle.id": handle.id,
      "upstream.url": sanitizeLoggedMediaPath(upstreamUrl),
      "media.range.present": Boolean(range),
      accept,
      "media.handle.pruned_count": prunedCount,
    });

    await proxyProviderMediaResponse(
      localUrlSession,
      handle,
      {
        accept,
        range: range ?? undefined,
      },
      async () => {
        try {
          const upstream = await fetchMediaHandleRequest(handle, { headers });
          if (!upstream.ok && upstream.status !== 206) {
            const body = await upstream.text();
            const detail = body.slice(0, 400).replaceAll(/\s+/g, " ").trim();
            throw createApiError(
              upstream.status,
              "local_media_url_failed",
              detail
                ? `URL media request failed: ${detail}`
                : "URL media request failed",
            );
          }

          return upstream;
        } catch (error) {
          localUrlLogger.warn("Local URL media request failed.", {
            ...logEventFields("media.local_url.fetch", "failure"),
            "media.handle.id": handle.id,
            "upstream.url": sanitizeLoggedMediaPath(upstreamUrl),
            "media.range.present": Boolean(range),
            accept,
            "error.message": errorMessage(error),
          });

          if (isApiError(error)) {
            throw error;
          }

          throw createApiError(
            502,
            "local_media_url_failed",
            `URL media request failed: ${errorMessage(error)}`,
          );
        }
      },
      res,
      {
        createMediaHandleUrl: createLocalUrlMediaHandleUrl,
      },
    );
  }),
);

mediaRouter.get(
  "/currently-playing",
  asyncHandler(async (request, res) => {
    setNoStore(res);
    const startedAt = Date.now();
    const session = requireAccountSession(request);
    const prunedCount = pruneSessionMediaHandles(session);
    const sourceErrors: SourcePlaybackError[] = [];
    const sources = listMediaSources({
      enabledOnly: true,
    }).flatMap((source) => {
      const provider = getProvider(source.providerId);
      if (!provider) {
        sourceErrors.push({
          sourceId: source.id,
          sourceName: source.name,
          providerId: source.providerId,
          message: "Source provider is not registered",
        });
        return [];
      }

      if (!(provider.supportsCurrentlyPlayingSource?.(source) ?? true)) {
        return [];
      }

      return [
        {
          source,
          provider,
        },
      ];
    });
    const settledResults = await Promise.allSettled(
      sources.map(async ({ source, provider }) => ({
        source,
        entries: await provider.listCurrentlyPlaying(session, source),
      })),
    );

    const entries: CurrentlyPlayingEntry[] = [];

    for (const [index, result] of settledResults.entries()) {
      const sourceContext = sources[index];
      if (!sourceContext) {
        continue;
      }
      const { source } = sourceContext;

      if (result.status === "fulfilled") {
        entries.push(...result.value.entries);
        continue;
      }

      sourceErrors.push({
        sourceId: source.id,
        sourceName: source.name,
        providerId: source.providerId,
        message: errorMessage(result.reason),
      });
    }

    const summaryFields = {
      ...logEventFields(
        "playback.currently_playing",
        sourceErrors.length > 0 ? "partial" : "success",
      ),
      ...logDurationFields(startedAt),
      "session.id": session.id,
      "session.provider.id": session.providerId,
      "session.provider.account.id": session.providerAccountId,
      "source.provider.ids": [
        ...new Set(sources.map(({ source }) => source.providerId)),
      ],
      "provider.account.count": new Set(
        sources.map(({ source }) => source.providerAccountId),
      ).size,
      "source.count": sources.length,
      "viewer.count": new Set(entries.map((entry) => entry.viewer.id)).size,
      "playback.item.count": entries.length,
      "source.error.count": sourceErrors.length,
      "media.handle.pruned_count": prunedCount,
      "media.handle.remaining_count": session.mediaHandles.size,
    };

    if (sourceErrors.length > 0) {
      discoveryLogger.warn(
        "Listed currently playing media with source errors.",
        {
          ...summaryFields,
          "source.error.provider_ids": [
            ...new Set(
              sourceErrors.map((sourceError) => sourceError.providerId),
            ),
          ],
        },
      );
    } else {
      discoveryLogger.info("Listed currently playing media.", summaryFields);
    }

    res.json({
      viewers: groupCurrentPlayback(entries),
      sourceErrors,
    });
  }),
);

mediaRouter.get(
  "/:handleId",
  asyncHandler(async (request, res) => {
    setNoStore(res);
    const session = requireAccountSession(request);
    const prunedCount = pruneSessionMediaHandles(session);
    const handle = session.mediaHandles.get(request.params.handleId as string);
    if (!handle) {
      proxyLogger.warn("Media handle was not found in provider session.", {
        ...logEventFields("media.proxy", "missing_handle"),
        "media.handle.id": request.params.handleId,
        "session.id": session.id,
        "provider.id": session.providerId,
        "provider.account.id": session.providerAccountId,
        "media.handle.pruned_count": prunedCount,
        "media.handle.remaining_count": session.mediaHandles.size,
      });
      throw createApiError(
        404,
        "media_not_found",
        "Media handle was not found or has expired",
      );
    }

    const provider = getProvider(handle.providerId);
    if (!provider) {
      proxyLogger.error("Provider for media handle is not registered.", {
        ...logEventFields("media.proxy", "provider_not_registered"),
        "media.handle.id": handle.id,
        "session.id": session.id,
        "provider.id": handle.providerId,
        "source.id": handle.sourceId,
      });
      throw createApiError(
        500,
        "provider_not_registered",
        "Session provider is not registered",
      );
    }

    proxyLogger.trace("Proxying media handle.", {
      "media.handle.id": handle.id,
      "session.id": session.id,
      "provider.id": handle.providerId,
      "source.id": handle.sourceId,
      "media.path": sanitizeLoggedMediaPath(handle.path),
      "media.base_path": sanitizeLoggedMediaPath(handle.basePath),
      "media.handle.pruned_count": prunedCount,
    });

    await provider.proxyMedia(
      session,
      request.params.handleId as string,
      request,
      res,
    );
  }),
);
