import type { DatabaseSync } from "node:sqlite";

const APP_TABLE_NAMES = [
  "provider_accounts",
  "media_sources",
  "provider_sessions",
] as const;
const DRIZZLE_MIGRATIONS_TABLE = "__drizzle_migrations";
const LEGACY_MIGRATIONS_TABLE = "schema_migrations";

function listUserTables(db: DatabaseSync) {
  const rows = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
  `).all() as Array<{ name: string }>;

  return new Set(rows.map((row) => row.name));
}

export function prepareDatabaseForMigrations(db: DatabaseSync) {
  const userTables = listUserTables(db);
  const hasDrizzleMigrationsTable = userTables.has(DRIZZLE_MIGRATIONS_TABLE);
  const existingAppTables = APP_TABLE_NAMES.filter((tableName) => userTables.has(tableName));

  if (!hasDrizzleMigrationsTable && (existingAppTables.length > 0 || userTables.has(LEGACY_MIGRATIONS_TABLE))) {
    throw new Error(
      "Detected a pre-release Cliparr database without Drizzle migration state. Delete the existing data directory and start again so the first-release schema can be created cleanly."
    );
  }
}
