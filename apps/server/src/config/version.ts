const LOCAL_CLIENT_VERSION = "dev";

function normalizeVersion(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  return normalized;
}

export function resolveCliparrVersion(env: NodeJS.ProcessEnv = process.env) {
  return normalizeVersion(env.CLIPARR_VERSION);
}

export function resolveCliparrClientVersion(
  env: NodeJS.ProcessEnv = process.env,
) {
  return resolveCliparrVersion(env) ?? LOCAL_CLIENT_VERSION;
}

export const CLIPARR_VERSION = resolveCliparrVersion();
export const CLIPARR_CLIENT_VERSION = resolveCliparrClientVersion();
