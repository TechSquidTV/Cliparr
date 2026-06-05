import "@/config/loadEnv";
import path from "node:path";
import { defineConfig } from "drizzle-kit";
import { resolveConfiguredDataDir, workspaceRoot } from "@/config/loadEnv";

const configuredDataDir = process.env.CLIPARR_DATA_DIR?.trim();
const dataDir = configuredDataDir
  ? resolveConfiguredDataDir(configuredDataDir)
  : path.join(workspaceRoot, ".cliparr-data");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: path.join(dataDir, "cliparr.sqlite"),
  },
});
