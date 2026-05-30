import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: {
    server: "src/server.ts",
  },
  format: "esm",
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  fixedExtension: false,
  alias: {
    "@": path.resolve(__dirname, "src"),
  },
  deps: {
    onlyBundle: false,
    alwaysBundle: [
      /^@cliparr\/shared(?:\/.*)?$/,
      /^@logtape\/logtape(?:\/.*)?$/,
      /^dotenv(?:\/.*)?$/,
      /^drizzle-orm(?:\/.*)?$/,
      /^express(?:\/.*)?$/,
    ],
  },
});
