import { randomUUID } from "crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDatabase } from "./database.js";
import { mediaSources, type MediaSourceRow } from "./schema.js";
import { decryptJsonSecrets, encryptJsonSecrets } from "../security/secrets.js";

export interface MediaSource {
  id: string;
  providerId: string;
  providerAccountId?: string;
  externalId?: string;
  name: string;
  enabled: boolean;
  baseUrl: string;
  connection: Record<string, unknown>;
  credentials: Record<string, unknown>;
  metadata: Record<string, unknown>;
  lastCheckedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMediaSourceInput {
  providerId: string;
  providerAccountId?: string;
  externalId?: string;
  name: string;
  enabled?: boolean;
  baseUrl: string;
  connection?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface UpdateMediaSourceInput {
  providerAccountId?: string | null;
  externalId?: string | null;
  name?: string;
  enabled?: boolean;
  baseUrl?: string;
  connection?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  lastCheckedAt?: string | null;
  lastError?: string | null;
}

function mapMediaSource(row: MediaSourceRow): MediaSource {
  return {
    id: row.id,
    providerId: row.providerId,
    providerAccountId: row.providerAccountId ?? undefined,
    externalId: row.externalId ?? undefined,
    name: row.name,
    enabled: row.enabled,
    baseUrl: row.baseUrl,
    connection: decryptJsonSecrets(row.connection),
    credentials: decryptJsonSecrets(row.credentials),
    metadata: row.metadata,
    lastCheckedAt: row.lastCheckedAt ?? undefined,
    lastError: row.lastError ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createMediaSource(input: CreateMediaSourceInput) {
  const db = getDatabase();
  const id = randomUUID();

  db.insert(mediaSources).values({
    id,
    providerId: input.providerId,
    providerAccountId: input.providerAccountId ?? null,
    externalId: input.externalId ?? null,
    name: input.name,
    enabled: input.enabled ?? true,
    baseUrl: input.baseUrl,
    connection: encryptJsonSecrets(input.connection ?? {}),
    credentials: encryptJsonSecrets(input.credentials ?? {}),
    metadata: input.metadata ?? {},
  }).run();

  return getMediaSource(id);
}

export function updateMediaSource(id: string, input: UpdateMediaSourceInput) {
  getDatabase()
    .update(mediaSources)
    .set({
      ...(input.providerAccountId !== undefined ? { providerAccountId: input.providerAccountId } : {}),
      ...(input.externalId !== undefined ? { externalId: input.externalId } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      ...(input.connection !== undefined ? { connection: encryptJsonSecrets(input.connection) } : {}),
      ...(input.credentials !== undefined ? { credentials: encryptJsonSecrets(input.credentials) } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      ...(input.lastCheckedAt !== undefined ? { lastCheckedAt: input.lastCheckedAt } : {}),
      ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
      updatedAt: sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    })
    .where(eq(mediaSources.id, id))
    .run();

  return getMediaSource(id);
}

export function getMediaSource(id: string) {
  const row = getDatabase()
    .select()
    .from(mediaSources)
    .where(eq(mediaSources.id, id))
    .get();

  return row ? mapMediaSource(row) : undefined;
}

export function getMediaSourceByProviderExternalId(providerId: string, externalId: string) {
  const row = getDatabase()
    .select()
    .from(mediaSources)
    .where(and(eq(mediaSources.providerId, providerId), eq(mediaSources.externalId, externalId)))
    .get();

  return row ? mapMediaSource(row) : undefined;
}

export function upsertMediaSource(input: CreateMediaSourceInput) {
  if (!input.externalId) {
    return createMediaSource(input);
  }

  const db = getDatabase();

  db.insert(mediaSources)
    .values({
      id: randomUUID(),
      providerId: input.providerId,
      providerAccountId: input.providerAccountId ?? null,
      externalId: input.externalId,
      name: input.name,
      enabled: input.enabled ?? true,
      baseUrl: input.baseUrl,
      connection: encryptJsonSecrets(input.connection ?? {}),
      credentials: encryptJsonSecrets(input.credentials ?? {}),
      metadata: input.metadata ?? {},
    })
    .onConflictDoUpdate({
      target: [mediaSources.providerId, mediaSources.externalId],
      targetWhere: sql`${mediaSources.externalId} IS NOT NULL`,
      set: {
        ...(input.providerAccountId !== undefined ? { providerAccountId: input.providerAccountId } : {}),
        name: input.name,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        baseUrl: input.baseUrl,
        ...(input.connection !== undefined ? { connection: encryptJsonSecrets(input.connection) } : {}),
        ...(input.credentials !== undefined ? { credentials: encryptJsonSecrets(input.credentials) } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        updatedAt: sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      },
    })
    .run();

  return getMediaSourceByProviderExternalId(input.providerId, input.externalId);
}

export function listMediaSources(options: { enabledOnly?: boolean; providerId?: string } = {}) {
  const db = getDatabase();
  const orderBy = asc(mediaSources.name);
  const enabledFilter = eq(mediaSources.enabled, true);

  if (options.enabledOnly && options.providerId) {
    return db.select().from(mediaSources)
      .where(and(enabledFilter, eq(mediaSources.providerId, options.providerId)))
      .orderBy(orderBy)
      .all()
      .map(mapMediaSource);
  }

  if (options.enabledOnly) {
    return db.select().from(mediaSources)
      .where(enabledFilter)
      .orderBy(orderBy)
      .all()
      .map(mapMediaSource);
  }

  if (options.providerId) {
    return db.select().from(mediaSources)
      .where(eq(mediaSources.providerId, options.providerId))
      .orderBy(orderBy)
      .all()
      .map(mapMediaSource);
  }

  return db.select().from(mediaSources).orderBy(orderBy).all().map(mapMediaSource);
}

export function updateMediaSourceHealth(id: string, input: { lastCheckedAt: string; lastError?: string }) {
  getDatabase()
    .update(mediaSources)
    .set({
      lastCheckedAt: input.lastCheckedAt,
      lastError: input.lastError ?? null,
      updatedAt: sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    })
    .where(eq(mediaSources.id, id))
    .run();

  return getMediaSource(id);
}
