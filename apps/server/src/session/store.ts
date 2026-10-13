import { randomUUID } from "node:crypto";

import { logErrorFields, logEventFields } from "@cliparr/shared/logging";
import { eq, lte } from "drizzle-orm";

import { getDatabase } from "@/db/database";
import { getProviderAccount } from "@/db/providerAccountsRepository";
import { type ProviderSessionRow, providerSessions } from "@/db/schema";
import { getServerLogger, warnWithError } from "@/logging";
import { notifyPlaybackStateChange } from "@/playback/stateChanges";
import type { MediaHandle } from "@/providers/types";
import { decryptSecret, encryptSecret } from "@/security/secrets";
import { SESSION_TTL_MS } from "@/session/constants";
import {
  deleteSessionMediaHandles,
  getSessionMediaHandles,
} from "@/session/mediaHandles";

const SESSION_CACHE_TTL_MS = 60_000;
const SESSION_CACHE_MAX_ENTRIES = 128;
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

function mapProviderSession(row: ProviderSessionRow): ProviderSessionRecord {
  return {
    id: row.id,
    providerId: row.providerId,
    providerAccountId: row.providerAccountId,
    userToken: decryptSecret(row.userToken),
    mediaHandles: getSessionMediaHandles(row.id),
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

function clearProviderSessionState(sessionId: string) {
  sessionCache.delete(sessionId);
  deleteSessionMediaHandles(sessionId);
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
