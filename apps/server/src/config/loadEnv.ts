import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const moduleDirectory = import.meta.dirname;
const initialCliparrDataDir = process.env.CLIPARR_DATA_DIR;
const initialEnvKeys = new Set(Object.keys(process.env));
let configuredDataDirBaseDir: string | undefined;

function findAncestorWith(startDir: string, entryName: string) {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (fs.existsSync(path.join(currentDir, entryName))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return;
    }

    currentDir = parentDir;
  }
}

export const serverRoot =
  findAncestorWith(moduleDirectory, "drizzle") ??
  findAncestorWith(process.cwd(), "drizzle") ??
  path.resolve(moduleDirectory, "..");

export const workspaceRoot =
  findAncestorWith(moduleDirectory, "pnpm-workspace.yaml") ??
  findAncestorWith(process.cwd(), "pnpm-workspace.yaml") ??
  path.resolve(serverRoot, "../..");

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

  const parsed = dotenv.parse(fs.readFileSync(resolvedPath));

  for (const [key, value] of Object.entries(parsed)) {
    if (initialEnvKeys.has(key)) {
      continue;
    }

    process.env[key] = value;
  }

  if (
    initialCliparrDataDir === undefined &&
    parsed.CLIPARR_DATA_DIR !== undefined
  ) {
    configuredDataDirBaseDir = path.dirname(resolvedPath);
  }

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
