import type { MediaSource } from "@/db/mediaSourcesRepository";

export interface PlexSourceIdentity {
  resourceKey?: string;
  urlKeys: string[];
}

function normalizePlexSourceUrl(value: string | undefined) {
  if (!value?.trim()) {
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return;
  }

  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.search = "";
  parsed.hash = "";

  const normalized = parsed.toString();
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function connectionUris(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const connections = (value as { connections?: unknown }).connections;
  if (!Array.isArray(connections)) {
    return [];
  }

  return connections
    .map((connection) =>
      connection && typeof connection === "object" && !Array.isArray(connection)
        ? (connection as { uri?: unknown }).uri
        : undefined,
    )
    .filter((uri): uri is string => typeof uri === "string");
}

function addUrlKey(keys: Set<string>, url: string | undefined) {
  const normalized = normalizePlexSourceUrl(url);
  if (normalized) {
    keys.add(`url:${normalized}`);
  }
}

function plexResourceIdKey(resourceId: string | undefined) {
  const normalized = resourceId?.trim();
  if (normalized) {
    return `resource:${normalized}`;
  }
}

export function plexSourceIdentity(source: MediaSource): PlexSourceIdentity {
  const urlKeys = new Set<string>();

  addUrlKey(urlKeys, source.baseUrl);
  for (const uri of connectionUris(source.connection)) {
    addUrlKey(urlKeys, uri);
  }

  return {
    resourceKey: plexResourceIdKey(source.externalId),
    urlKeys: [...urlKeys].toSorted(),
  };
}
