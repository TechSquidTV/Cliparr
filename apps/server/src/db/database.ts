import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { logErrorFields, logEventFields } from "@cliparr/shared/logging";
import { prepareDatabaseForMigrations } from "@/db/migrationState";
import { cleanupDuplicatePlexSources } from "@/db/plexSourceDeduplication";
import * as schema from "@/db/schema";
import {
  resolveConfiguredDataDir,
  serverRoot,
  workspaceRoot,
} from "@/config/loadEnv";
import { getServerLogger, warnWithError } from "@/logging";
import { assertAppKeyConfigured } from "@/security/secrets";

const DEFAULT_DATABASE_FILE = "cliparr.sqlite";
const DEFAULT_DEVELOPMENT_DATA_DIR = ".cliparr-data";
const MIGRATIONS_FOLDER = path.join(serverRoot, "drizzle");

type CliparrDatabase = NodeSQLiteDatabase<typeof schema>;

let sqlite: DatabaseSync | undefined;
let database: CliparrDatabase | undefined;
let databasePath: string | undefined;
let dataDir: string | undefined;
const logger = getServerLogger("db");

function enforcePermissions(targetPath: string, mode: number) {
  try {
    fs.chmodSync(targetPath, mode);
  } catch (error) {
    if (process.platform !== "win32") {
      logger.warn("Could not set filesystem permissions.", {
        "file.path": targetPath,
        mode,
        ...logErrorFields(error),
      });
    }
  }
}

function resolveDataDir() {
  const configuredDataDir = process.env.CLIPARR_DATA_DIR?.trim();
  if (configuredDataDir) {
    return resolveConfiguredDataDir(configuredDataDir);
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "CLIPARR_DATA_DIR is required in production so the SQLite database has a persistent home.",
    );
  }

  return path.join(workspaceRoot, DEFAULT_DEVELOPMENT_DATA_DIR);
}

function runPostMigrationMaintenance() {
  try {
    cleanupDuplicatePlexSources();
  } catch (error) {
    warnWithError(
      logger,
      error,
      "Post-migration database maintenance failed.",
      {
        ...logEventFields("db.post_migration_maintenance", "failure"),
        ...logErrorFields(error),
      },
    );
  }
}

export function initializeDatabase() {
  if (database) {
    return database;
  }

  assertAppKeyConfigured();
  dataDir = resolveDataDir();
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  enforcePermissions(dataDir, 0o700);

  databasePath = path.join(dataDir, DEFAULT_DATABASE_FILE);
  sqlite = new DatabaseSync(databasePath);
  enforcePermissions(databasePath, 0o600);
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
  `);
  database = drizzle({ client: sqlite, schema });
  prepareDatabaseForMigrations(sqlite);
  migrate(database, { migrationsFolder: MIGRATIONS_FOLDER });
  runPostMigrationMaintenance();

  return database;
}

export function getDatabase() {
  if (!database) {
    throw new Error("Database has not been initialized.");
  }

  return database;
}

function getSqliteClient() {
  if (!sqlite) {
    throw new Error("Database has not been initialized.");
  }

  return sqlite;
}

export function closeDatabase() {
  if (sqlite) {
    sqlite.close();
    sqlite = undefined;
    database = undefined;
  }
}

export function checkDatabaseHealth() {
  getSqliteClient().prepare("SELECT 1 AS ok").get();
}
