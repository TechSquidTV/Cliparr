import "dotenv/config";
import path from "path";
import { defineConfig } from "drizzle-kit";

const configuredDataDir = process.env.CLIPARR_DATA_DIR?.trim();
const dataDir = configuredDataDir ? path.resolve(configuredDataDir) : path.resolve(process.cwd(), "../../.cliparr-data");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: path.join(dataDir, "cliparr.sqlite"),
  },
});
