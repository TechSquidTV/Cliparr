import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDatabase } from "./database.js";
import { providerAccounts, type ProviderAccountRow } from "./schema.js";

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

function mapProviderAccount(row: ProviderAccountRow): ProviderAccount {
  return {
    id: row.id,
    providerId: row.providerId,
    label: row.label,
    accessToken: row.accessToken ?? undefined,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createProviderAccount(input: CreateProviderAccountInput) {
  const db = getDatabase();
  const id = randomUUID();

  db.insert(providerAccounts).values({
    id,
    providerId: input.providerId,
    label: input.label,
    accessToken: input.accessToken ?? null,
    metadata: input.metadata ?? {},
  }).run();

  return getProviderAccount(id);
}

export function updateProviderAccount(id: string, input: UpdateProviderAccountInput) {
  getDatabase()
    .update(providerAccounts)
    .set({
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.accessToken !== undefined ? { accessToken: input.accessToken } : {}),
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
  const row = getDatabase()
    .select()
    .from(providerAccounts)
    .where(and(eq(providerAccounts.providerId, providerId), eq(providerAccounts.accessToken, accessToken)))
    .get();

  return row ? mapProviderAccount(row) : undefined;
}

export function upsertProviderAccountByAccessToken(input: CreateProviderAccountInput) {
  if (input.accessToken) {
    const existing = getProviderAccountByAccessToken(input.providerId, input.accessToken);
    if (existing) {
      return updateProviderAccount(existing.id, {
        label: input.label,
        metadata: input.metadata ?? existing.metadata,
      });
    }
  }

  return createProviderAccount(input);
}

export function listProviderAccounts(providerId?: string) {
  const db = getDatabase();
  const rows = providerId
    ? db.select().from(providerAccounts).where(eq(providerAccounts.providerId, providerId)).all()
    : db.select().from(providerAccounts).all();

  return rows.map(mapProviderAccount);
}
