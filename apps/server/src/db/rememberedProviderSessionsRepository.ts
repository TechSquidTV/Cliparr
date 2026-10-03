import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNotNull, isNull, lte, or } from "drizzle-orm";
import { getDatabase } from "@/db/database";
import {
  rememberedProviderSessions,
  type RememberedProviderSessionRow,
} from "@/db/schema";
import { currentTimestampSql } from "@/db/timestamps";
import { hashSecret } from "@/security/secrets";

export const REMEMBERED_PROVIDER_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export interface RememberedProviderSession {
  id: string;
  providerAccountId: string;
  createdAt: number;
  expiresAt: number;
  revokedAt?: number;
}

export interface CreatedRememberedProviderSession extends RememberedProviderSession {
  token: string;
}

function createRememberToken() {
  return randomBytes(32).toString("base64url");
}

function mapRememberedProviderSession(
  row: RememberedProviderSessionRow,
): RememberedProviderSession {
  return {
    id: row.id,
    providerAccountId: row.providerAccountId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt ?? undefined,
  };
}

export function createRememberedProviderSession(
  providerAccountId: string,
): CreatedRememberedProviderSession {
  const now = Date.now();
  const id = randomUUID();
  const token = createRememberToken();
  const expiresAt = now + REMEMBERED_PROVIDER_SESSION_TTL_MS;

  getDatabase()
    .insert(rememberedProviderSessions)
    .values({
      id,
      providerAccountId,
      tokenHash: hashSecret(token),
      createdAt: now,
      expiresAt,
      revokedAt: null,
    })
    .run();

  return {
    id,
    providerAccountId,
    token,
    createdAt: now,
    expiresAt,
  };
}

export function getRememberedProviderSession(token?: string) {
  if (!token) {
    return;
  }

  const row = getDatabase()
    .select()
    .from(rememberedProviderSessions)
    .where(eq(rememberedProviderSessions.tokenHash, hashSecret(token)))
    .get();

  if (
    !row ||
    (row.revokedAt !== null && row.revokedAt !== undefined) ||
    row.expiresAt <= Date.now()
  ) {
    return;
  }

  return mapRememberedProviderSession(row);
}

export function revokeRememberedProviderSession(token?: string) {
  if (!token) {
    return false;
  }

  const now = Date.now();
  const result = getDatabase()
    .update(rememberedProviderSessions)
    .set({
      revokedAt: now,
      updatedAt: currentTimestampSql(),
    })
    .where(eq(rememberedProviderSessions.tokenHash, hashSecret(token)))
    .run();

  return result.changes > 0;
}

// Issues a fresh token for a live remembered session and revokes the
// presented one, so a stolen token dies the next time the legitimate client
// uses it. The pair is applied transactionally: callers must treat an
// undefined return as an invalid token.
export function rotateRememberedProviderSession(
  token?: string,
): CreatedRememberedProviderSession | undefined {
  if (!token) {
    return;
  }

  return getDatabase().transaction(
    (tx) => {
      const now = Date.now();
      // Claim the live credential under the write lock. A competing rotation,
      // revocation, or sweep cannot leave us issuing a token from a stale row.
      const row = tx
        .update(rememberedProviderSessions)
        .set({ revokedAt: now, updatedAt: currentTimestampSql() })
        .where(
          and(
            eq(rememberedProviderSessions.tokenHash, hashSecret(token)),
            isNull(rememberedProviderSessions.revokedAt),
            gt(rememberedProviderSessions.expiresAt, now),
          ),
        )
        .returning({
          providerAccountId: rememberedProviderSessions.providerAccountId,
        })
        .get();
      if (!row) {
        return;
      }

      // Reuse creation inside the transaction so insertion failure rolls back
      // the revocation and preserves the client's existing credential.
      return createRememberedProviderSession(row.providerAccountId);
    },
    { behavior: "immediate" },
  );
}

// Deletes remembered sessions that can never be used again: expired rows and
// revoked rows (logout or rotation leftovers). Returns the number removed.
export function purgeExpiredRememberedProviderSessions(now = Date.now()) {
  const result = getDatabase()
    .delete(rememberedProviderSessions)
    .where(
      or(
        lte(rememberedProviderSessions.expiresAt, now),
        isNotNull(rememberedProviderSessions.revokedAt),
      ),
    )
    .run();

  return Number(result.changes);
}
