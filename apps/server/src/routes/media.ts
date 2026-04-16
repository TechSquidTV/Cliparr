import { Router } from "express";
import { listMediaSources } from "../db/mediaSourcesRepository.js";
import { ApiError, asyncHandler } from "../http/errors.js";
import { getProvider } from "../providers/registry.js";
import type { CurrentlyPlayingEntry, SourcePlaybackError, ViewerPlaybackGroup } from "../providers/types.js";
import { requireSession, setNoStore } from "../session/request.js";
import { pruneSessionMediaHandles } from "../session/store.js";

export const mediaRouter = Router();

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
    const session = requireSession(req);
    pruneSessionMediaHandles(session);
    const provider = getProvider(session.providerId);
    if (!provider) {
      throw new ApiError(500, "provider_not_registered", "Session provider is not registered");
    }

    const sources = listMediaSources({ enabledOnly: true, providerId: session.providerId })
      .filter((source) => provider.supportsCurrentlyPlayingSource?.(source) ?? true);
    const settledResults = await Promise.allSettled(
      sources.map(async (source) => ({
        source,
        entries: await provider.listCurrentlyPlaying(session, source),
      }))
    );

    const entries: CurrentlyPlayingEntry[] = [];
    const sourceErrors: SourcePlaybackError[] = [];

    settledResults.forEach((result, index) => {
      const source = sources[index];
      if (!source) {
        return;
      }

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
    const session = requireSession(req);
    pruneSessionMediaHandles(session);
    const provider = getProvider(session.providerId);
    if (!provider) {
      throw new ApiError(500, "provider_not_registered", "Session provider is not registered");
    }

    await provider.proxyMedia(session, req.params.handleId as string, req, res);
  })
);
