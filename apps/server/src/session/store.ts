import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { logErrorFields, logEventFields } from "@cliparr/shared/logging";
import { getDatabase } from "#/db/database.js";
import { getProviderAccount } from "#/db/providerAccountsRepository.js";
import { REMEMBERED_PROVIDER_SESSION_TTL_MS } from "#/db/rememberedProviderSessionsRepository.js";
import { providerSessions, type ProviderSessionRow } from "#/db/schema.js";
import { getServerLogger } from "#/logging.js";
import type { MediaHandle } from "#/providers/types.js";
import { decryptSecret, encryptSecret } from "#/security/secrets.js";

const SESSION_COOKIE = "cliparr_session";
const REMEMBERED_PROVIDER_SESSION_COOKIE = "cliparr_remember";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const MEDIA_HANDLE_IDLE_TTL_MS = 1000 * 60 * 15;
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
    return undefined;
  }

  const row = getDatabase()
    .select()
    .from(providerSessions)
    .where(eq(providerSessions.id, sessionId))
    .get();

  if (!row) {
    return undefined;
  }

  if (row.expiresAt <= Date.now()) {
    deleteProviderSession(sessionId);
    return undefined;
  }

  return mapProviderSession(row);
}

export function restoreProviderSessionFromProviderAccount(
  providerAccountId?: string,
) {
  if (!providerAccountId) {
    return undefined;
  }

  try {
    const account = getProviderAccount(providerAccountId);
    if (!account?.accessToken) {
      return undefined;
    }

    return createProviderSession({
      providerId: account.providerId,
      providerAccountId: account.id,
      userToken: account.accessToken,
    });
  } catch (err) {
    logger.warn(
      "Failed to restore provider session from remembered provider account.",
      {
        ...logEventFields("session.restore", "failure"),
        ...logErrorFields(err),
        "provider.account.id": providerAccountId,
      },
    );
    return undefined;
  }
}

export function pruneSessionMediaHandles(
  session: ProviderSessionRecord,
  maxIdleMs = MEDIA_HANDLE_IDLE_TTL_MS,
) {
  const cutoff = Date.now() - maxIdleMs;
  let prunedCount = 0;

  for (const [handleId, handle] of session.mediaHandles.entries()) {
    if (handle.lastAccessedAt >= cutoff) {
      continue;
    }

    session.mediaHandles.delete(handleId);
    prunedCount += 1;
  }

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

export function deleteProviderSession(sessionId?: string) {
  if (sessionId) {
    getDatabase()
      .delete(providerSessions)
      .where(eq(providerSessions.id, sessionId))
      .run();
    mediaHandlesBySessionId.delete(sessionId);
  }
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
    return undefined;
  }

  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const prefix = `${name}=`;
  const match = cookies.find((cookie) => cookie.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : undefined;
}
