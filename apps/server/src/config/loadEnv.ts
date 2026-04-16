import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const initialCliparrDataDir = process.env.CLIPARR_DATA_DIR;
let configuredDataDirBaseDir: string | undefined;

export const workspaceRoot = path.resolve(__dirname, "../../../..");
const envPaths = [
  path.join(workspaceRoot, ".env"),
  path.join(process.cwd(), ".env"),
];

const loadedPaths = new Set<string>();

for (const envPath of envPaths) {
  const resolvedPath = path.resolve(envPath);
  if (loadedPaths.has(resolvedPath) || !fs.existsSync(resolvedPath)) {
    continue;
  }

  if (initialCliparrDataDir === undefined) {
    const parsed = dotenv.parse(fs.readFileSync(resolvedPath));
    if (configuredDataDirBaseDir === undefined && parsed.CLIPARR_DATA_DIR !== undefined) {
      configuredDataDirBaseDir = path.dirname(resolvedPath);
    }
  }

  dotenv.config({ path: resolvedPath, quiet: true });
  loadedPaths.add(resolvedPath);
}

export function resolveConfiguredDataDir(configuredDataDir: string) {
  if (path.isAbsolute(configuredDataDir)) {
    return configuredDataDir;
  }

  if (initialCliparrDataDir === undefined && configuredDataDirBaseDir) {
    return path.resolve(configuredDataDirBaseDir, configuredDataDir);
  }

  return path.resolve(configuredDataDir);
}
