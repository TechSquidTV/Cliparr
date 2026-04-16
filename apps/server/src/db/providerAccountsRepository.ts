import { randomUUID } from "crypto";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getDatabase } from "./database.js";
import { providerAccounts, type ProviderAccountRow } from "./schema.js";
import { decryptSecret, encryptSecret, hashSecret } from "../security/secrets.js";

export interface ProviderAccount {
  id: string;
  providerId: string;
  label: string;
  accessToken?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProviderAccountInput {
  providerId: string;
  label: string;
  accessToken?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateProviderAccountInput {
  label?: string;
  accessToken?: string;
  metadata?: Record<string, unknown>;
}

function normalizeAccessToken(accessToken: string | undefined) {
  return accessToken === "" ? null : accessToken;
}

function mapProviderAccount(row: ProviderAccountRow): ProviderAccount {
  return {
    id: row.id,
    providerId: row.providerId,
    label: row.label,
    accessToken: row.accessToken != null ? decryptSecret(row.accessToken) : undefined,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createProviderAccount(input: CreateProviderAccountInput) {
  const db = getDatabase();
  const id = randomUUID();
  const accessToken = normalizeAccessToken(input.accessToken);

  db.insert(providerAccounts).values({
    id,
    providerId: input.providerId,
    label: input.label,
    accessToken: accessToken ? encryptSecret(accessToken) : null,
    accessTokenHash: accessToken ? hashSecret(accessToken) : null,
    metadata: input.metadata ?? {},
  }).run();

  return getProviderAccount(id);
}

export function updateProviderAccount(id: string, input: UpdateProviderAccountInput) {
  const accessToken = input.accessToken !== undefined ? normalizeAccessToken(input.accessToken) : undefined;

  getDatabase()
    .update(providerAccounts)
    .set({
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(accessToken !== undefined
        ? {
          accessToken: accessToken ? encryptSecret(accessToken) : null,
          accessTokenHash: accessToken ? hashSecret(accessToken) : null,
        }
        : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      updatedAt: sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    })
    .where(eq(providerAccounts.id, id))
    .run();

  return getProviderAccount(id);
}

export function getProviderAccount(id: string) {
  const row = getDatabase()
    .select()
    .from(providerAccounts)
    .where(eq(providerAccounts.id, id))
    .get();

  return row ? mapProviderAccount(row) : undefined;
}

export function getProviderAccountByAccessToken(providerId: string, accessToken: string) {
  const db = getDatabase();
  const tokenHash = hashSecret(accessToken);
  const row = db
    .select()
    .from(providerAccounts)
    .where(and(eq(providerAccounts.providerId, providerId), eq(providerAccounts.accessTokenHash, tokenHash)))
    .get();

  if (row) {
    return mapProviderAccount(row);
  }

  const fallback = db
    .select()
    .from(providerAccounts)
    .where(and(
      eq(providerAccounts.providerId, providerId),
      isNull(providerAccounts.accessTokenHash),
      isNotNull(providerAccounts.accessToken)
    ))
    .all()
    .find((candidate) => candidate.accessToken != null && decryptSecret(candidate.accessToken) === accessToken);

  return fallback ? mapProviderAccount(fallback) : undefined;
}

export function upsertProviderAccountByAccessToken(input: CreateProviderAccountInput) {
  if (!input.accessToken) {
    return createProviderAccount(input);
  }

  const existing = getProviderAccountByAccessToken(input.providerId, input.accessToken);
  if (existing) {
    return updateProviderAccount(existing.id, {
      label: input.label,
      accessToken: input.accessToken,
      metadata: input.metadata,
    });
  }

  const db = getDatabase();

  db.insert(providerAccounts)
    .values({
      id: randomUUID(),
      providerId: input.providerId,
      label: input.label,
      accessToken: encryptSecret(input.accessToken),
      accessTokenHash: hashSecret(input.accessToken),
      metadata: input.metadata ?? {},
    })
    .onConflictDoUpdate({
      target: [providerAccounts.providerId, providerAccounts.accessTokenHash],
      targetWhere: sql`${providerAccounts.accessTokenHash} IS NOT NULL`,
      set: {
        label: input.label,
        accessToken: encryptSecret(input.accessToken),
        accessTokenHash: hashSecret(input.accessToken),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        updatedAt: sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      },
    })
    .run();

  return getProviderAccountByAccessToken(input.providerId, input.accessToken);
}

export function listProviderAccounts(providerId?: string) {
  const db = getDatabase();
  const rows = providerId
    ? db.select().from(providerAccounts).where(eq(providerAccounts.providerId, providerId)).all()
    : db.select().from(providerAccounts).all();

  return rows.map(mapProviderAccount);
}
