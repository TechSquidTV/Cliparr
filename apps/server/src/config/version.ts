import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.resolve(__dirname, "../../package.json");

function normalizeVersion(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  return normalized;
}

function readPackageVersion() {
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      version?: unknown;
    };

    return typeof packageJson.version === "string" ? normalizeVersion(packageJson.version) : undefined;
  } catch {
    return undefined;
  }
}

export function resolveCliparrVersion(env: NodeJS.ProcessEnv = process.env) {
  return (
    normalizeVersion(env.CLIPARR_VERSION) ??
    normalizeVersion(env.npm_package_version) ??
    readPackageVersion() ??
    "0.0.0"
  );
}

export const CLIPARR_VERSION = resolveCliparrVersion();
