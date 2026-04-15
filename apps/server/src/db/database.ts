import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "url";
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { runMigrations } from "./migrations.js";
import * as schema from "./schema.js";

const DEFAULT_DATABASE_FILE = "cliparr.sqlite";
const DEFAULT_DEVELOPMENT_DATA_DIR = ".cliparr-data";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../../../..");

export type CliparrDatabase = NodeSQLiteDatabase<typeof schema>;

let sqlite: DatabaseSync | undefined;
let database: CliparrDatabase | undefined;
let databasePath: string | undefined;
let dataDir: string | undefined;

function resolveDataDir() {
  const configuredDataDir = process.env.CLIPARR_DATA_DIR?.trim();
  if (configuredDataDir) {
    return path.resolve(configuredDataDir);
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("CLIPARR_DATA_DIR is required in production so the SQLite database has a persistent home.");
  }

  return path.join(workspaceRoot, DEFAULT_DEVELOPMENT_DATA_DIR);
}

export function initializeDatabase() {
  if (database) {
    return database;
  }

  dataDir = resolveDataDir();
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  databasePath = path.join(dataDir, DEFAULT_DATABASE_FILE);
  sqlite = new DatabaseSync(databasePath);
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
  `);
  runMigrations(sqlite);
  database = drizzle({ client: sqlite, schema });

  return database;
}

export function getDatabase() {
  if (!database) {
    throw new Error("Database has not been initialized.");
  }

  return database;
}

export function getSqliteClient() {
  if (!sqlite) {
    throw new Error("Database has not been initialized.");
  }

  return sqlite;
}

export function getDatabaseInfo() {
  return {
    dataDir,
    databasePath,
  };
}

export function checkDatabaseHealth() {
  getSqliteClient().prepare("SELECT 1 AS ok").get();
}
