import type { DatabaseSync } from "node:sqlite";

const APP_TABLE_NAMES = [
  "provider_accounts",
  "media_sources",
  "provider_sessions",
  "remembered_provider_sessions",
] as const;
const DRIZZLE_MIGRATIONS_TABLE = "__drizzle_migrations";
const LEGACY_MIGRATIONS_TABLE = "schema_migrations";
const PRE_V1_DATABASE_ERROR =
  "Detected a pre-v1.0.0 Cliparr database. Delete the existing data directory and start again so the first-release schema can be created cleanly.";
export const V1_BASELINE_MIGRATION_NAME = "20260531000000_v1_0_0_baseline";

function sqliteIdentifier(name: string) {
  return `"${name.replaceAll('"', '""')}"`;
}

function listUserTables(db: DatabaseSync) {
  const rows = db
    .prepare(
      `
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
  `,
    )
    .all() as Array<{ name: string }>;

  return new Set(rows.map((row) => row.name));
}

function hasColumn(db: DatabaseSync, tableName: string, columnName: string) {
  const rows = db
    .prepare(`PRAGMA table_info(${sqliteIdentifier(tableName)})`)
    .all() as Array<{ name: string }>;

  return rows.some((row) => row.name === columnName);
}

function listDrizzleMigrationNames(db: DatabaseSync) {
  if (!hasColumn(db, DRIZZLE_MIGRATIONS_TABLE, "name")) {
    return new Set<string>();
  }

  const rows = db
    .prepare(
      `
    SELECT name
    FROM ${sqliteIdentifier(DRIZZLE_MIGRATIONS_TABLE)}
    WHERE name IS NOT NULL
  `,
    )
    .all() as Array<{ name: string }>;

  return new Set(rows.map((row) => row.name));
}

export function prepareDatabaseForMigrations(db: DatabaseSync) {
  const userTables = listUserTables(db);
  const hasDrizzleMigrationsTable = userTables.has(DRIZZLE_MIGRATIONS_TABLE);
  const existingAppTables = APP_TABLE_NAMES.filter((tableName) =>
    userTables.has(tableName),
  );

  if (userTables.has(LEGACY_MIGRATIONS_TABLE)) {
    throw new Error(PRE_V1_DATABASE_ERROR);
  }

  if (existingAppTables.length === 0) {
    return;
  }

  if (!hasDrizzleMigrationsTable) {
    throw new Error(PRE_V1_DATABASE_ERROR);
  }

  const migrationNames = listDrizzleMigrationNames(db);

  if (!migrationNames.has(V1_BASELINE_MIGRATION_NAME)) {
    throw new Error(PRE_V1_DATABASE_ERROR);
  }
}
