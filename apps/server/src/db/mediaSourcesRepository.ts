import { randomUUID } from "node:crypto";
import { and, asc, eq, type SQL } from "drizzle-orm";
import { getDatabase } from "@/db/database";
import { mediaSources, type MediaSourceRow } from "@/db/schema";
import { currentTimestampSql } from "@/db/timestamps";
import { decryptJsonSecrets, encryptJsonSecrets } from "@/security/secrets";

export interface MediaSource {
  id: string;
  providerId: string;
  providerAccountId: string;
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

interface CreateMediaSourceInput {
  providerId: string;
  providerAccountId: string;
  externalId?: string;
  name: string;
  enabled?: boolean;
  baseUrl: string;
  connection?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface UpdateMediaSourceInput {
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
    providerAccountId: row.providerAccountId,
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

function getMediaSourceWhere(where: SQL<unknown>) {
  const row = getDatabase().select().from(mediaSources).where(where).get();

  return row ? mapMediaSource(row) : undefined;
}

function listMediaSourcesWhere(where?: SQL<unknown>) {
  const query = getDatabase().select().from(mediaSources);
  const rows = where
    ? query.where(where).orderBy(asc(mediaSources.name)).all()
    : query.orderBy(asc(mediaSources.name)).all();

  return rows.map((row) => mapMediaSource(row));
}

function createMediaSource(input: CreateMediaSourceInput) {
  const db = getDatabase();
  const id = randomUUID();

  db.insert(mediaSources)
    .values({
      id,
      providerId: input.providerId,
      providerAccountId: input.providerAccountId,
      externalId: input.externalId ?? null,
      name: input.name,
      enabled: input.enabled ?? true,
      baseUrl: input.baseUrl,
      connection: encryptJsonSecrets(input.connection ?? {}),
      credentials: encryptJsonSecrets(input.credentials ?? {}),
      metadata: input.metadata ?? {},
    })
    .run();

  return getMediaSource(id);
}

export function updateMediaSource(id: string, input: UpdateMediaSourceInput) {
  getDatabase()
    .update(mediaSources)
    .set({
      ...(input.externalId === undefined
        ? {}
        : { externalId: input.externalId }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
      ...(input.connection === undefined
        ? {}
        : { connection: encryptJsonSecrets(input.connection) }),
      ...(input.credentials === undefined
        ? {}
        : { credentials: encryptJsonSecrets(input.credentials) }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      ...(input.lastCheckedAt === undefined
        ? {}
        : { lastCheckedAt: input.lastCheckedAt }),
      ...(input.lastError === undefined ? {} : { lastError: input.lastError }),
      updatedAt: currentTimestampSql(),
    })
    .where(eq(mediaSources.id, id))
    .run();

  return getMediaSource(id);
}

export function getMediaSource(id: string) {
  return getMediaSourceWhere(eq(mediaSources.id, id));
}

export function getMediaSourceForAccount(
  id: string,
  providerAccountId: string,
) {
  const where = and(
    eq(mediaSources.id, id),
    eq(mediaSources.providerAccountId, providerAccountId),
  );

  return where ? getMediaSourceWhere(where) : undefined;
}

export function deleteMediaSource(id: string) {
  const result = getDatabase()
    .delete(mediaSources)
    .where(eq(mediaSources.id, id))
    .run();

  return result.changes > 0;
}

export function getMediaSourceByProviderExternalId(
  providerId: string,
  providerAccountId: string,
  externalId: string,
) {
  const where = and(
    eq(mediaSources.providerId, providerId),
    eq(mediaSources.providerAccountId, providerAccountId),
    eq(mediaSources.externalId, externalId),
  );

  return where ? getMediaSourceWhere(where) : undefined;
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
      providerAccountId: input.providerAccountId,
      externalId: input.externalId,
      name: input.name,
      enabled: input.enabled ?? true,
      baseUrl: input.baseUrl,
      connection: encryptJsonSecrets(input.connection ?? {}),
      credentials: encryptJsonSecrets(input.credentials ?? {}),
      metadata: input.metadata ?? {},
    })
    .onConflictDoUpdate({
      target: [
        mediaSources.providerId,
        mediaSources.providerAccountId,
        mediaSources.externalId,
      ],
      set: {
        name: input.name,
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        baseUrl: input.baseUrl,
        ...(input.connection === undefined
          ? {}
          : { connection: encryptJsonSecrets(input.connection) }),
        ...(input.credentials === undefined
          ? {}
          : { credentials: encryptJsonSecrets(input.credentials) }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        updatedAt: currentTimestampSql(),
      },
    })
    .run();

  return getMediaSourceByProviderExternalId(
    input.providerId,
    input.providerAccountId,
    input.externalId,
  );
}

export function listMediaSources(
  options: {
    enabledOnly?: boolean;
    providerId?: string;
    providerAccountId?: string;
  } = {},
) {
  const filters: SQL<unknown>[] = [];

  if (options.enabledOnly) {
    filters.push(eq(mediaSources.enabled, true));
  }

  if (options.providerId) {
    filters.push(eq(mediaSources.providerId, options.providerId));
  }

  if (options.providerAccountId) {
    filters.push(eq(mediaSources.providerAccountId, options.providerAccountId));
  }

  let where: SQL | undefined;
  if (filters.length === 1) {
    where = filters[0];
  } else if (filters.length > 1) {
    where = and(...filters);
  }

  return listMediaSourcesWhere(where);
}
