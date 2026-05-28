import { randomUUID } from "crypto";
import { Router } from "express";
import { listMediaSources } from "../db/mediaSourcesRepository.js";
import { ApiError, asyncHandler } from "../http/errors.js";
import { getServerLogger } from "../logging.js";
import { getProvider } from "../providers/registry.js";
import {
  assertAllowedMediaHandleRequestUrl,
  fetchMediaHandleRequest,
  mediaHandleRequestUrl,
  proxyProviderMediaResponse,
  sanitizeLoggedMediaPath,
  shouldForwardMediaRange,
} from "../providers/shared/mediaProxy.js";
import type {
  CurrentlyPlayingEntry,
  MediaHandle,
  SourcePlaybackError,
  ViewerPlaybackGroup,
} from "../providers/types.js";
import { requireAccountSession, setNoStore } from "../session/request.js";
import { pruneSessionMediaHandles, type ProviderSessionRecord } from "../session/store.js";

export const mediaRouter = Router();
const logger = getServerLogger(["routes", "media"]);
const LOCAL_URL_PROVIDER_ID = "local-url";
const LOCAL_URL_SOURCE_ID = "remote-url";
const LOCAL_URL_MEDIA_BASE_URL = "http://cliparr.local";
const HLS_PLAYLIST_PATTERN = /\.m3u8(?:$|[?#])/i;
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

function groupCurrentPlayback(entries: CurrentlyPlayingEntry[]): ViewerPlaybackGroup[] {
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
      items: [...group.items].sort((left, right) =>
        compareStrings(left.source.name, right.source.name)
        || compareStrings(left.playerTitle, right.playerTitle)
        || compareStrings(left.title, right.title)
        || compareStrings(left.id, right.id)
      ),
    }))
    .sort((left, right) =>
      compareStrings(left.viewer.name, right.viewer.name)
      || compareStrings(left.viewer.id, right.viewer.id)
    );
}

function errorMessage(err: unknown) {
  if (err instanceof Error) {
    return err.message;
  }

  return "Unknown error";
}

function bodyUrl(value: unknown) {
  const body = value && typeof value === "object" ? value as { url?: unknown } : null;
  if (typeof body?.url !== "string") {
    throw new ApiError(400, "local_media_url_invalid", "Media URL is required");
  }

  return body.url;
}

function parseLocalMediaUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ApiError(400, "local_media_url_invalid", "Media URL is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ApiError(400, "local_media_url_invalid", "Enter a valid absolute media URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiError(400, "local_media_url_invalid", "Media URL must use HTTP or HTTPS");
  }

  return parsed;
}

function localUrlMediaPath(handleId: string) {
  return `/api/media/local-url/${handleId}`;
}

function isHlsPlaylistUrl(url: string) {
  return HLS_PLAYLIST_PATTERN.test(url);
}

function buildLocalUrlMediaHandle(value: string, basePath?: string): MediaHandle {
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
  asyncHandler(async (req, res) => {
    setNoStore(res);
    pruneSessionMediaHandles(localUrlSession);

    const handle = buildLocalUrlMediaHandle(bodyUrl(req.body));
    await assertAllowedMediaHandleRequestUrl(handle);
    const mediaUrl = storeLocalUrlMediaHandle(handle);

    logger.trace("Created local URL media handle {handleId}.", {
      handleId: handle.id,
      upstreamUrl: sanitizeLoggedMediaPath(handle.path),
      hls: isHlsPlaylistUrl(handle.path),
    });

    res.status(201).json({
      mediaUrl,
      hls: isHlsPlaylistUrl(handle.path),
    });
  })
);

mediaRouter.get(
  "/local-url/:handleId",
  asyncHandler(async (req, res) => {
    setNoStore(res);
    const prunedCount = pruneSessionMediaHandles(localUrlSession);
    const handle = localUrlMediaHandles.get(req.params.handleId as string);
    if (!handle) {
      throw new ApiError(404, "local_media_url_not_found", "URL media handle was not found or has expired");
    }

    handle.lastAccessedAt = Date.now();

    const accept = req.header("accept") ?? undefined;
    const requestedRange = req.header("range") ?? undefined;
    const range = shouldForwardMediaRange(handle, requestedRange);
    const headers = new Headers(accept ? { Accept: accept } : undefined);
    if (range) {
      headers.set("Range", range);
    }

    const upstreamUrl = mediaHandleRequestUrl(handle).toString();
    logger.trace("Fetching local URL media for handle {handleId}.", {
      handleId: handle.id,
      upstreamUrl: sanitizeLoggedMediaPath(upstreamUrl),
      hasRange: Boolean(range),
      accept,
      prunedCount,
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
            const detail = (await upstream.text()).slice(0, 400).replace(/\s+/g, " ").trim();
            throw new ApiError(
              upstream.status,
              "local_media_url_failed",
              detail ? `URL media request failed: ${detail}` : "URL media request failed"
            );
          }

          return upstream;
        } catch (err) {
          logger.warn("Local URL media request failed for handle {handleId}.", {
            handleId: handle.id,
            upstreamUrl: sanitizeLoggedMediaPath(upstreamUrl),
            hasRange: Boolean(range),
            accept,
            errorMessage: errorMessage(err),
          });

          if (err instanceof ApiError) {
            throw err;
          }

          throw new ApiError(502, "local_media_url_failed", `URL media request failed: ${errorMessage(err)}`);
        }
      },
      res,
      {
        createMediaHandleUrl: createLocalUrlMediaHandleUrl,
      },
    );
  })
);

mediaRouter.get(
  "/currently-playing",
  asyncHandler(async (req, res) => {
    setNoStore(res);
    const session = requireAccountSession(req);
    const prunedCount = pruneSessionMediaHandles(session);
    const sourceErrors: SourcePlaybackError[] = [];
    const sources = listMediaSources({
      enabledOnly: true,
      providerAccountId: session.providerAccountId,
    })
      .flatMap((source) => {
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

        return [{
          source,
          provider,
        }];
      });
    const settledResults = await Promise.allSettled(
      sources.map(async ({ source, provider }) => ({
        source,
        entries: await provider.listCurrentlyPlaying(session, source),
      }))
    );

    const entries: CurrentlyPlayingEntry[] = [];

    settledResults.forEach((result, index) => {
      const sourceContext = sources[index];
      if (!sourceContext) {
        return;
      }
      const { source } = sourceContext;

      if (result.status === "fulfilled") {
        entries.push(...result.value.entries);
        return;
      }

      sourceErrors.push({
        sourceId: source.id,
        sourceName: source.name,
        providerId: source.providerId,
        message: errorMessage(result.reason),
      });
    });

    logger.trace("Listed currently playing media.", {
      sessionId: session.id,
      providerId: session.providerId,
      providerAccountId: session.providerAccountId,
      sourceCount: sources.length,
      viewerCount: new Set(entries.map((entry) => entry.viewer.id)).size,
      entryCount: entries.length,
      sourceErrorCount: sourceErrors.length,
      prunedHandleCount: prunedCount,
      remainingHandleCount: session.mediaHandles.size,
    });

    res.json({
      viewers: groupCurrentPlayback(entries),
      sourceErrors,
    });
  })
);

mediaRouter.get(
  "/:handleId",
  asyncHandler(async (req, res) => {
    setNoStore(res);
    const session = requireAccountSession(req);
    const prunedCount = pruneSessionMediaHandles(session);
    const handle = session.mediaHandles.get(req.params.handleId as string);
    if (!handle) {
      logger.warn("Media handle {handleId} was not found in provider session {sessionId}.", {
        handleId: req.params.handleId,
        sessionId: session.id,
        providerId: session.providerId,
        providerAccountId: session.providerAccountId,
        prunedHandleCount: prunedCount,
        remainingHandleCount: session.mediaHandles.size,
      });
      throw new ApiError(404, "media_not_found", "Media handle was not found or has expired");
    }

    const provider = getProvider(handle.providerId);
    if (!provider) {
      logger.error("Provider {providerId} for media handle {handleId} is not registered.", {
        handleId: handle.id,
        sessionId: session.id,
        providerId: handle.providerId,
        sourceId: handle.sourceId,
      });
      throw new ApiError(500, "provider_not_registered", "Session provider is not registered");
    }

    logger.trace("Proxying media handle {handleId}.", {
      handleId: handle.id,
      sessionId: session.id,
      providerId: handle.providerId,
      sourceId: handle.sourceId,
      path: sanitizeLoggedMediaPath(handle.path),
      basePath: sanitizeLoggedMediaPath(handle.basePath),
      prunedHandleCount: prunedCount,
    });

    await provider.proxyMedia(session, req.params.handleId as string, req, res);
  })
);
