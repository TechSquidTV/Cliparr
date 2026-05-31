import { randomBytes, randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/db/database";
import {
  rememberedProviderSessions,
  type RememberedProviderSessionRow,
} from "@/db/schema";
import { currentTimestampSql } from "@/db/timestamps";
import { hashSecret } from "@/security/secrets";

export const REMEMBERED_PROVIDER_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 365;

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
    return undefined;
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
    return undefined;
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
