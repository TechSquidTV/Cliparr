import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const includeSourceMap = process.env.CLIPARR_SERVER_SOURCEMAP !== "false";

export default defineConfig({
  entry: {
    server: "src/server.ts",
  },
  format: "esm",
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  sourcemap: includeSourceMap,
  fixedExtension: false,
  alias: {
    "@": path.resolve(__dirname, "src"),
  },
  deps: {
    onlyBundle: false,
    alwaysBundle: [
      /^@cliparr\/shared(?:\/.*)?$/,
      /^@jellyfin\/sdk(?:\/.*)?$/,
      /^@logtape\/logtape(?:\/.*)?$/,
      /^axios(?:\/.*)?$/,
      /^dotenv(?:\/.*)?$/,
      /^drizzle-orm(?:\/.*)?$/,
      /^express(?:\/.*)?$/,
    ],
  },
});
