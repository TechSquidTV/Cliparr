import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  prepareDatabaseForMigrations,
  V1_BASELINE_MIGRATION_NAME,
} from "@/db/migrationState";

const PRE_V1_DATABASE_PATTERN = /pre-v1\.0\.0 Cliparr database/u;

function withDatabase(callback: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(":memory:");

  try {
    callback(db);
  } finally {
    db.close();
  }
}

function createProviderAccountsTable(db: DatabaseSync) {
  db.exec("CREATE TABLE provider_accounts (id text PRIMARY KEY)");
}

function createDrizzleMigrationsTable(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE __drizzle_migrations (
      id INTEGER PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric,
      name text,
      applied_at TEXT
    )
  `);
}

function insertDrizzleMigration(db: DatabaseSync, name: string) {
  db.prepare(
    `
    INSERT INTO __drizzle_migrations (hash, created_at, name, applied_at)
    VALUES (?, ?, ?, ?)
  `,
  ).run("hash", Date.UTC(2026, 4, 31), name, new Date(0).toISOString());
}

void test("allows empty databases before the v1.0.0 baseline migration runs", () => {
  withDatabase((db) => {
    assert.doesNotThrow(() => prepareDatabaseForMigrations(db));
  });
});

void test("rejects pre-v1 databases without Drizzle migration state", () => {
  withDatabase((db) => {
    createProviderAccountsTable(db);

    assert.throws(
      () => prepareDatabaseForMigrations(db),
      PRE_V1_DATABASE_PATTERN,
    );
  });
});

void test("rejects legacy schema migration state", () => {
  withDatabase((db) => {
    db.exec("CREATE TABLE schema_migrations (version text PRIMARY KEY)");

    assert.throws(
      () => prepareDatabaseForMigrations(db),
      PRE_V1_DATABASE_PATTERN,
    );
  });
});

void test("rejects old Drizzle migration history after the v1.0.0 collapse", () => {
  withDatabase((db) => {
    createProviderAccountsTable(db);
    createDrizzleMigrationsTable(db);
    insertDrizzleMigration(db, "20260418064431_baseline");

    assert.throws(
      () => prepareDatabaseForMigrations(db),
      PRE_V1_DATABASE_PATTERN,
    );
  });
});

void test("allows databases with the collapsed v1.0.0 baseline migration state", () => {
  withDatabase((db) => {
    createProviderAccountsTable(db);
    createDrizzleMigrationsTable(db);
    insertDrizzleMigration(db, V1_BASELINE_MIGRATION_NAME);

    assert.doesNotThrow(() => prepareDatabaseForMigrations(db));
  });
});
