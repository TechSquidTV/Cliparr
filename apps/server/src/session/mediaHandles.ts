import { getServerLogger } from "@/logging";
import { removeMediaHandleFromIndex } from "@/providers/shared/mediaHandles";
import type { MediaHandle } from "@/providers/types";
import { SESSION_TTL_MS } from "@/session/constants";
import type { ProviderSessionRecord } from "@/session/store";

const MEDIA_HANDLE_PRUNE_INTERVAL_MS = 60_000;
const MEDIA_HANDLE_PRUNE_SIZE_THRESHOLD = 2000;
const logger = getServerLogger(["session", "media_handles"]);

const lastMediaHandlePrune = new WeakMap<
  Map<string, MediaHandle>,
  { at: number; size: number }
>();
const mediaHandlesBySessionId = new Map<string, Map<string, MediaHandle>>();

export function getSessionMediaHandles(sessionId: string) {
  let mediaHandles = mediaHandlesBySessionId.get(sessionId);
  if (!mediaHandles) {
    mediaHandles = new Map<string, MediaHandle>();
    mediaHandlesBySessionId.set(sessionId, mediaHandles);
  }
  return mediaHandles;
}

export function pruneSessionMediaHandles(
  session: ProviderSessionRecord,
  // Editors retain playlist and segment URLs, even while paused. Keep them
  // available for the full session so later seeks and exports can reuse them.
  maxIdleMs = SESSION_TTL_MS,
) {
  const now = Date.now();
  const lastPrune = lastMediaHandlePrune.get(session.mediaHandles);
  const size = session.mediaHandles.size;
  // Allow an early scan on threshold crossing or doubling. An oversized map
  // that stays the same size must still wait for the normal interval.
  const grewPastThreshold =
    lastPrune !== undefined &&
    size > MEDIA_HANDLE_PRUNE_SIZE_THRESHOLD &&
    (lastPrune.size <= MEDIA_HANDLE_PRUNE_SIZE_THRESHOLD ||
      size >= lastPrune.size * 2);
  if (
    lastPrune !== undefined &&
    now - lastPrune.at < MEDIA_HANDLE_PRUNE_INTERVAL_MS &&
    !grewPastThreshold
  ) {
    return 0;
  }
  const cutoff = now - maxIdleMs;
  let prunedCount = 0;

  for (const [handleId, handle] of session.mediaHandles.entries()) {
    if (handle.lastAccessedAt >= cutoff) {
      continue;
    }

    session.mediaHandles.delete(handleId);
    removeMediaHandleFromIndex(session.mediaHandles, handle);
    prunedCount += 1;
  }
  lastMediaHandlePrune.set(session.mediaHandles, {
    at: now,
    size: session.mediaHandles.size,
  });

  if (prunedCount > 0) {
    logger.trace("Pruned stale media handles for provider session.", {
      "session.id": session.id,
      "provider.id": session.providerId,
      "provider.account.id": session.providerAccountId,
      "media.handle.pruned_count": prunedCount,
      "media.handle.remaining_count": session.mediaHandles.size,
      "media.handle.max_idle_ms": maxIdleMs,
      "media.handle.cutoff_ms": cutoff,
    });
  }

  return prunedCount;
}

export function deleteSessionMediaHandles(sessionId: string) {
  mediaHandlesBySessionId.delete(sessionId);
}
