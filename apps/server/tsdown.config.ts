import { readFileSync } from "node:fs";
import path from "node:path";

import { defineConfig } from "tsdown";

const configDirectory = import.meta.dirname;
const nodeVersion = readFileSync(
  new URL("../../.nvmrc", import.meta.url),
  "utf8",
).trim();
const includeSourceMap = process.env.CLIPARR_SERVER_SOURCEMAP !== "false";

export default defineConfig({
  entry: {
    server: "src/server.ts",
  },
  format: "esm",
  platform: "node",
  target: `node${nodeVersion}`,
  outDir: "dist",
  clean: true,
  sourcemap: includeSourceMap,
  fixedExtension: false,
  alias: {
    "@": path.resolve(configDirectory, "src"),
  },
  deps: {
    onlyBundle: false,
    alwaysBundle: [
      /^@cliparr\/plex(?:\/.*)?$/,
      /^@cliparr\/shared(?:\/.*)?$/,
      /^@jellyfin\/sdk(?:\/.*)?$/,
      /^@logtape\/(?:logtape|redaction)(?:\/.*)?$/,
      /^axios(?:\/.*)?$/,
      /^dotenv(?:\/.*)?$/,
      /^drizzle-orm(?:\/.*)?$/,
      /^express(?:\/.*)?$/,
      /^undici(?:\/.*)?$/,
    ],
  },
});
