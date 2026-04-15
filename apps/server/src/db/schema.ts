import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const schemaMigrations = sqliteTable("schema_migrations", {
  id: integer("id").primaryKey(),
  name: text("name").notNull().unique(),
  appliedAt: text("applied_at").notNull().default(nowIso),
});

export const providerAccounts = sqliteTable(
  "provider_accounts",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull(),
    label: text("label").notNull(),
    accessToken: text("access_token"),
    metadata: text("metadata_json", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    createdAt: text("created_at").notNull().default(nowIso),
    updatedAt: text("updated_at").notNull().default(nowIso),
  },
  (table) => [
    index("provider_accounts_provider_id_idx").on(table.providerId),
  ]
);

export const mediaSources = sqliteTable(
  "media_sources",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull(),
    providerAccountId: text("provider_account_id").references(() => providerAccounts.id, { onDelete: "set null" }),
    externalId: text("external_id"),
    name: text("name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    baseUrl: text("base_url").notNull(),
    connection: text("connection_json", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    credentials: text("credentials_json", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    metadata: text("metadata_json", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    lastCheckedAt: text("last_checked_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull().default(nowIso),
    updatedAt: text("updated_at").notNull().default(nowIso),
  },
  (table) => [
    index("media_sources_enabled_idx").on(table.enabled),
    index("media_sources_provider_id_idx").on(table.providerId),
    index("media_sources_provider_account_id_idx").on(table.providerAccountId),
    uniqueIndex("media_sources_provider_external_id_idx")
      .on(table.providerId, table.externalId)
      .where(sql`${table.externalId} IS NOT NULL`),
  ]
);

export const providerSessions = sqliteTable(
  "provider_sessions",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull(),
    providerAccountId: text("provider_account_id").references(() => providerAccounts.id, { onDelete: "set null" }),
    userToken: text("user_token").notNull(),
    resources: text("resources_json", { mode: "json" }).$type<unknown[]>().notNull().default([]),
    selectedResource: text("selected_resource_json", { mode: "json" }).$type<unknown | null>(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    updatedAt: text("updated_at").notNull().default(nowIso),
  },
  (table) => [
    index("provider_sessions_provider_id_idx").on(table.providerId),
    index("provider_sessions_provider_account_id_idx").on(table.providerAccountId),
    index("provider_sessions_expires_at_idx").on(table.expiresAt),
  ]
);

export type ProviderAccountRow = typeof providerAccounts.$inferSelect;
export type MediaSourceRow = typeof mediaSources.$inferSelect;
export type ProviderSessionRow = typeof providerSessions.$inferSelect;
