import { Router } from "express";
import { listMediaSources } from "../db/mediaSourcesRepository.js";
import { ApiError, asyncHandler } from "../http/errors.js";
import { getServerLogger } from "../logging.js";
import { getProvider } from "../providers/registry.js";
import type { CurrentlyPlayingEntry, SourcePlaybackError, ViewerPlaybackGroup } from "../providers/types.js";
import { requireAccountSession, setNoStore } from "../session/request.js";
import { pruneSessionMediaHandles } from "../session/store.js";

export const mediaRouter = Router();
const logger = getServerLogger(["routes", "media"]);

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

    logger.debug("Listed currently playing media.", {
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

    logger.debug("Proxying media handle {handleId}.", {
      handleId: handle.id,
      sessionId: session.id,
      providerId: handle.providerId,
      sourceId: handle.sourceId,
      path: handle.path,
      basePath: handle.basePath,
      prunedHandleCount: prunedCount,
    });

    await provider.proxyMedia(session, req.params.handleId as string, req, res);
  })
);
