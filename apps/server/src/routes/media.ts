import { groupCurrentPlayback } from "@/playback/groupPlayback";
import { Router } from "express";
import { logDurationFields, logEventFields } from "@cliparr/shared/logging";
import { listMediaSources } from "@/db/mediaSourcesRepository";
import { asyncHandler, createApiError } from "@/http/errors";
import { getServerLogger } from "@/logging";
import {
  createLocalUrlMedia,
  proxyLocalUrlMedia,
} from "@/providers/localUrl/provider";
import { getProvider } from "@/providers/registry";
import { sanitizeLoggedMediaPath } from "@/providers/shared/mediaUrlPolicy";
import { errorMessage } from "@/providers/shared/utilities";
import type {
  CurrentlyPlayingEntry,
  SourcePlaybackError,
} from "@/providers/types";
import { requireAccountSession, setNoStore } from "@/session/request";
import { pruneSessionMediaHandles } from "@/session/store";

export const mediaRouter = Router();
const mediaLogger = getServerLogger("media");
const discoveryLogger = mediaLogger.getChild("discovery");
const proxyLogger = mediaLogger.getChild("proxy");

mediaRouter.post(
  "/local-url",
  asyncHandler(async (request, res) => {
    setNoStore(res);
    requireAccountSession(request);
    const { mediaUrl, hls } = await createLocalUrlMedia(request.body);
    res.status(201).json({ mediaUrl, hls });
  }),
);

mediaRouter.get(
  "/local-url/:handleId",
  asyncHandler(async (request, res) => {
    setNoStore(res);
    requireAccountSession(request);
    await proxyLocalUrlMedia(request.params.handleId as string, request, res);
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
      providerAccountId: session.providerAccountId,
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
