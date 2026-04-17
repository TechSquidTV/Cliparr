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

      CREATE UNIQUE INDEX provider_accounts_provider_access_token_idx
        ON provider_accounts(provider_id, access_token)
        WHERE access_token IS NOT NULL;

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
  {
    id: 3,
    name: "ensure_provider_accounts_access_token_uniqueness",
    sql: `
      CREATE TEMP TABLE duplicate_provider_accounts AS
      SELECT id, canonical_id
      FROM (
        SELECT
          id,
          FIRST_VALUE(id) OVER (
            PARTITION BY provider_id, access_token
            ORDER BY created_at ASC, id ASC
          ) AS canonical_id,
          ROW_NUMBER() OVER (
            PARTITION BY provider_id, access_token
            ORDER BY created_at ASC, id ASC
          ) AS row_num
        FROM provider_accounts
        WHERE access_token IS NOT NULL
      )
      WHERE row_num > 1;

      UPDATE media_sources
      SET provider_account_id = (
        SELECT canonical_id
        FROM duplicate_provider_accounts
        WHERE duplicate_provider_accounts.id = media_sources.provider_account_id
      )
      WHERE provider_account_id IN (
        SELECT id
        FROM duplicate_provider_accounts
      );

      UPDATE provider_sessions
      SET provider_account_id = (
        SELECT canonical_id
        FROM duplicate_provider_accounts
        WHERE duplicate_provider_accounts.id = provider_sessions.provider_account_id
      )
      WHERE provider_account_id IN (
        SELECT id
        FROM duplicate_provider_accounts
      );

      DELETE FROM provider_accounts
      WHERE id IN (
        SELECT id
        FROM duplicate_provider_accounts
      );

      DROP TABLE duplicate_provider_accounts;

      CREATE UNIQUE INDEX IF NOT EXISTS provider_accounts_provider_access_token_idx
        ON provider_accounts(provider_id, access_token)
        WHERE access_token IS NOT NULL;
    `,
  },
  {
    id: 4,
    name: "add_provider_accounts_access_token_hash",
    sql: `
      ALTER TABLE provider_accounts
      ADD COLUMN access_token_hash TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS provider_accounts_provider_access_token_hash_idx
        ON provider_accounts(provider_id, access_token_hash)
        WHERE access_token_hash IS NOT NULL;
    `,
  },
  {
    id: 5,
    name: "drop_legacy_provider_session_resource_fields",
    sql: `
      CREATE TABLE provider_sessions_next (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        provider_account_id TEXT REFERENCES provider_accounts(id) ON DELETE SET NULL,
        user_token TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      INSERT INTO provider_sessions_next (
        id,
        provider_id,
        provider_account_id,
        user_token,
        created_at,
        expires_at,
        updated_at
      )
      SELECT
        id,
        provider_id,
        provider_account_id,
        user_token,
        created_at,
        expires_at,
        updated_at
      FROM provider_sessions;

      DROP TABLE provider_sessions;

      ALTER TABLE provider_sessions_next RENAME TO provider_sessions;

      CREATE INDEX provider_sessions_provider_id_idx
        ON provider_sessions(provider_id);

      CREATE INDEX provider_sessions_provider_account_id_idx
        ON provider_sessions(provider_account_id);

      CREATE INDEX provider_sessions_expires_at_idx
        ON provider_sessions(expires_at);
    `,
  },
  {
    id: 6,
    name: "scope_media_sources_external_ids_by_provider_account",
    sql: `
      DROP INDEX IF EXISTS media_sources_provider_external_id_idx;

      CREATE UNIQUE INDEX media_sources_provider_external_id_idx
        ON media_sources(provider_id, provider_account_id, external_id)
        WHERE external_id IS NOT NULL AND provider_account_id IS NOT NULL;
    `,
  },
  {
    id: 7,
    name: "require_provider_account_ownership",
    sql: `
      CREATE TABLE media_sources_next (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        provider_account_id TEXT NOT NULL REFERENCES provider_accounts(id) ON DELETE CASCADE,
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

      INSERT INTO media_sources_next (
        id,
        provider_id,
        provider_account_id,
        external_id,
        name,
        enabled,
        base_url,
        connection_json,
        credentials_json,
        metadata_json,
        last_checked_at,
        last_error,
        created_at,
        updated_at
      )
      SELECT
        id,
        provider_id,
        provider_account_id,
        external_id,
        name,
        enabled,
        base_url,
        connection_json,
        credentials_json,
        metadata_json,
        last_checked_at,
        last_error,
        created_at,
        updated_at
      FROM media_sources
      WHERE provider_account_id IS NOT NULL;

      DROP TABLE media_sources;

      ALTER TABLE media_sources_next RENAME TO media_sources;

      CREATE INDEX media_sources_enabled_idx
        ON media_sources(enabled);

      CREATE INDEX media_sources_provider_id_idx
        ON media_sources(provider_id);

      CREATE INDEX media_sources_provider_account_id_idx
        ON media_sources(provider_account_id);

      CREATE UNIQUE INDEX media_sources_provider_external_id_idx
        ON media_sources(provider_id, provider_account_id, external_id)
        WHERE external_id IS NOT NULL;

      CREATE TABLE provider_sessions_next (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        provider_account_id TEXT NOT NULL REFERENCES provider_accounts(id) ON DELETE CASCADE,
        user_token TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      INSERT INTO provider_sessions_next (
        id,
        provider_id,
        provider_account_id,
        user_token,
        created_at,
        expires_at,
        updated_at
      )
      SELECT
        id,
        provider_id,
        provider_account_id,
        user_token,
        created_at,
        expires_at,
        updated_at
      FROM provider_sessions
      WHERE provider_account_id IS NOT NULL;

      DROP TABLE provider_sessions;

      ALTER TABLE provider_sessions_next RENAME TO provider_sessions;

      CREATE INDEX provider_sessions_provider_id_idx
        ON provider_sessions(provider_id);

      CREATE INDEX provider_sessions_provider_account_id_idx
        ON provider_sessions(provider_account_id);

      CREATE INDEX provider_sessions_expires_at_idx
        ON provider_sessions(expires_at);
    `,
  },
  {
    id: 8,
    name: "make_media_source_external_id_uniqueness_unconditional",
    sql: `
      DROP INDEX IF EXISTS media_sources_provider_external_id_idx;

      CREATE UNIQUE INDEX media_sources_provider_external_id_idx
        ON media_sources(provider_id, provider_account_id, external_id);
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
