import type { DatabaseSync } from "node:sqlite";

interface Migration {
  id: number;
  name: string;
  sql: string;
}

const migrations: Migration[] = [
  {
    id: 1,
    name: "create_provider_accounts_and_media_sources",
    sql: `
      CREATE TABLE provider_accounts (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        label TEXT NOT NULL,
        access_token TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX provider_accounts_provider_id_idx
        ON provider_accounts(provider_id);

      CREATE TABLE media_sources (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        provider_account_id TEXT REFERENCES provider_accounts(id) ON DELETE SET NULL,
        external_id TEXT,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        base_url TEXT NOT NULL,
        connection_json TEXT NOT NULL DEFAULT '{}',
        credentials_json TEXT NOT NULL DEFAULT '{}',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        last_checked_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX media_sources_enabled_idx
        ON media_sources(enabled);

      CREATE INDEX media_sources_provider_id_idx
        ON media_sources(provider_id);

      CREATE INDEX media_sources_provider_account_id_idx
        ON media_sources(provider_account_id);

      CREATE UNIQUE INDEX media_sources_provider_external_id_idx
        ON media_sources(provider_id, external_id)
        WHERE external_id IS NOT NULL;
    `,
  },
  {
    id: 2,
    name: "create_provider_sessions",
    sql: `
      CREATE TABLE IF NOT EXISTS provider_sessions (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        provider_account_id TEXT REFERENCES provider_accounts(id) ON DELETE SET NULL,
        user_token TEXT NOT NULL,
        resources_json TEXT NOT NULL DEFAULT '[]',
        selected_resource_json TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS provider_sessions_provider_id_idx
        ON provider_sessions(provider_id);

      CREATE INDEX IF NOT EXISTS provider_sessions_provider_account_id_idx
        ON provider_sessions(provider_account_id);

      CREATE INDEX IF NOT EXISTS provider_sessions_expires_at_idx
        ON provider_sessions(expires_at);
    `,
  },
];

export function runMigrations(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const appliedRows = db.prepare("SELECT id FROM schema_migrations").all() as Array<{ id: number }>;
  const appliedIds = new Set(appliedRows.map((row) => Number(row.id)));
  const insertMigration = db.prepare("INSERT INTO schema_migrations (id, name) VALUES (?, ?)");

  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) {
      continue;
    }

    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      insertMigration.run(migration.id, migration.name);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
