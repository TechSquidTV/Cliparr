import { notifyPlaybackStateChange } from "@/playback/stateChanges";
import { randomUUID } from "node:crypto";
import { eq, lte } from "drizzle-orm";
import { logErrorFields, logEventFields } from "@cliparr/shared/logging";
import { getDatabase } from "@/db/database";
import { getProviderAccount } from "@/db/providerAccountsRepository";
import { REMEMBERED_PROVIDER_SESSION_TTL_MS } from "@/db/rememberedProviderSessionsRepository";
import { providerSessions, type ProviderSessionRow } from "@/db/schema";
import { getServerLogger, warnWithError } from "@/logging";
import { removeMediaHandleFromIndex } from "@/providers/shared/mediaHandles";
import type { MediaHandle } from "@/providers/types";
import { decryptSecret, encryptSecret } from "@/security/secrets";

const SESSION_COOKIE = "cliparr_session";
const REMEMBERED_PROVIDER_SESSION_COOKIE = "cliparr_remember";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const SESSION_CACHE_TTL_MS = 60_000;
const SESSION_CACHE_MAX_ENTRIES = 128;
const MEDIA_HANDLE_PRUNE_INTERVAL_MS = 60_000;
const MEDIA_HANDLE_PRUNE_SIZE_THRESHOLD = 2000;
const logger = getServerLogger(["session", "store"]);

export interface ProviderSessionRecord {
  id: string;
  providerId: string;
  providerAccountId: string;
  userToken: string;
  mediaHandles: Map<string, MediaHandle>;
  createdAt: number;
  expiresAt: number;
}

const sessionCache = new Map<
  string,
  { record: ProviderSessionRecord; cachedUntil: number }
>();
const lastMediaHandlePrune = new WeakMap<
  Map<string, MediaHandle>,
  { at: number; size: number }
>();
const mediaHandlesBySessionId = new Map<string, Map<string, MediaHandle>>();

function getMediaHandles(sessionId: string) {
  let mediaHandles = mediaHandlesBySessionId.get(sessionId);
  if (!mediaHandles) {
    mediaHandles = new Map<string, MediaHandle>();
    mediaHandlesBySessionId.set(sessionId, mediaHandles);
  }
  return mediaHandles;
}

function mapProviderSession(row: ProviderSessionRow): ProviderSessionRecord {
  return {
    id: row.id,
    providerId: row.providerId,
    providerAccountId: row.providerAccountId,
    userToken: decryptSecret(row.userToken),
    mediaHandles: getMediaHandles(row.id),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

export function createProviderSession(input: {
  providerId: string;
  providerAccountId: string;
  userToken: string;
}) {
  const now = Date.now();
  const id = randomUUID();
  const expiresAt = now + SESSION_TTL_MS;

  getDatabase()
    .insert(providerSessions)
    .values({
      id,
      providerId: input.providerId,
      providerAccountId: input.providerAccountId,
      userToken: encryptSecret(input.userToken),
      createdAt: now,
      expiresAt,
    })
    .run();

  return mapProviderSession({
    id,
    providerId: input.providerId,
    providerAccountId: input.providerAccountId,
    userToken: input.userToken,
    createdAt: now,
    expiresAt,
    updatedAt: new Date(now).toISOString(),
  });
}

export function getProviderSession(sessionId?: string) {
  if (!sessionId) {
    return;
  }

  const now = Date.now();
  const cached = sessionCache.get(sessionId);
  if (cached) {
    if (cached.record.expiresAt <= now) {
      deleteProviderSession(sessionId);
      return;
    }
    sessionCache.delete(sessionId);
    if (cached.cachedUntil > now) {
      sessionCache.set(sessionId, cached);
      return cached.record;
    }
  }

  const row = getDatabase()
    .select()
    .from(providerSessions)
    .where(eq(providerSessions.id, sessionId))
    .get();

  if (!row) {
    return;
  }

  if (row.expiresAt <= now) {
    deleteProviderSession(sessionId);
    return;
  }

  const record = mapProviderSession(row);
  sessionCache.set(sessionId, {
    record,
    cachedUntil: now + SESSION_CACHE_TTL_MS,
  });
  if (sessionCache.size > SESSION_CACHE_MAX_ENTRIES) {
    const oldestSessionId = sessionCache.keys().next().value;
    if (oldestSessionId !== undefined) {
      sessionCache.delete(oldestSessionId);
    }
  }
  return record;
}

// Called after Plex account reassignment commits, so disconnects immediately
// read the canonical account ID without losing the session's live handle map.
export function invalidateProviderSessionCacheForAccounts(
  providerAccountIds: ReadonlySet<string>,
) {
  for (const [sessionId, cached] of sessionCache) {
    if (providerAccountIds.has(cached.record.providerAccountId)) {
      sessionCache.delete(sessionId);
    }
  }
}

export function restoreProviderSessionFromProviderAccount(
  providerAccountId?: string,
) {
  if (!providerAccountId) {
    return;
  }

  try {
    const account = getProviderAccount(providerAccountId);
    if (!account?.accessToken) {
      return;
    }

    return createProviderSession({
      providerId: account.providerId,
      providerAccountId: account.id,
      userToken: account.accessToken,
    });
  } catch (error) {
    warnWithError(
      logger,
      error,
      "Failed to restore provider session from remembered provider account.",
      {
        ...logEventFields("session.restore", "failure"),
        ...logErrorFields(error),
        "provider.account.id": providerAccountId,
      },
    );
    return;
  }
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

function clearProviderSessionState(sessionId: string) {
  sessionCache.delete(sessionId);
  mediaHandlesBySessionId.delete(sessionId);
  notifyPlaybackStateChange({ type: "session", sessionId });
}

export function deleteProviderSession(sessionId?: string) {
  if (sessionId) {
    getDatabase()
      .delete(providerSessions)
      .where(eq(providerSessions.id, sessionId))
      .run();
    clearProviderSessionState(sessionId);
  }
}

export function deleteProviderSessionsForProviderAccount(
  providerAccountId?: string,
) {
  if (!providerAccountId) {
    return 0;
  }

  const db = getDatabase();
  const sessionRows = db
    .select({ id: providerSessions.id })
    .from(providerSessions)
    .where(eq(providerSessions.providerAccountId, providerAccountId))
    .all();
  const result = db
    .delete(providerSessions)
    .where(eq(providerSessions.providerAccountId, providerAccountId))
    .run();

  for (const session of sessionRows) {
    clearProviderSessionState(session.id);
  }

  return Number(result.changes);
}

// Deletes provider sessions past their expiry, including their cached
// records and media handles. Expired sessions are also refused lazily on
// access; this sweep keeps the table and in-memory maps from growing
// unboundedly. Returns the number removed.
export function purgeExpiredProviderSessions(now = Date.now()) {
  const expiredSessions = getDatabase()
    .delete(providerSessions)
    .where(lte(providerSessions.expiresAt, now))
    .returning({ id: providerSessions.id })
    .all();

  for (const { id } of expiredSessions) {
    clearProviderSessionState(id);
  }

  return expiredSessions.length;
}

export function getSessionCookieName() {
  return SESSION_COOKIE;
}

export function getRememberedProviderSessionCookieName() {
  return REMEMBERED_PROVIDER_SESSION_COOKIE;
}

export function getSessionCookieOptions(secure: boolean) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure,
    maxAge: SESSION_TTL_MS,
  };
}

export function getRememberedProviderSessionCookieOptions(secure: boolean) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure,
    maxAge: REMEMBERED_PROVIDER_SESSION_TTL_MS,
  };
}

export function getSessionCookieClearOptions(secure: boolean) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure,
  };
}

export function getRememberedProviderSessionCookieClearOptions(
  secure: boolean,
) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure,
  };
}

export function readCookie(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) {
    return;
  }

  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const prefix = `${name}=`;
  const match = cookies.find((cookie) => cookie.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : undefined;
}
