import { randomUUID } from "crypto";
import { getPublicAppUrl } from "../../config/publicUrl.js";
import type { MediaSource } from "../../db/mediaSourcesRepository.js";
import { ApiError } from "../../http/errors.js";
import { normalizeMediaPath } from "../shared/mediaProxy.js";
import { errorMessage, numberValue, stringValue } from "../shared/utils.js";
import type { ProviderResource } from "../types.js";
import {
  plexBaseUrlMode,
  PLEX_BASE_URL_MODE_AUTO,
  PLEX_BASE_URL_MODE_MANUAL,
  type PlexBaseUrlMode,
} from "./connectionState.js";

export const PLEX_PRODUCT = "Cliparr";
export const PLEX_CLIENT_IDENTIFIER = process.env.PLEX_CLIENT_IDENTIFIER ?? `cliparr-${randomUUID()}`;
export const AUTH_TTL_MS = 1000 * 60 * 10;
export const MAX_PENDING_AUTH_REQUESTS = 512;
export const CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS = 5000;

const PLEX_AUTH_COMPLETE_PATH = "/auth/plex/complete";
const CONNECTION_PROBE_TIMEOUT_MS = 2500;

export interface PlexAuthRequest {
  authId: string;
  pinId: number;
  code: string;
  expiresAt: number;
}

export interface PlexResourceResponse {
  name?: string;
  product?: string;
  platform?: string;
  clientIdentifier?: string;
  machineIdentifier?: string;
  provides?: string;
  owned?: boolean;
  accessToken?: string;
  connections?: {
    uri?: string;
    local?: boolean;
    relay?: boolean;
    protocol?: string;
    address?: string;
    port?: number;
  }[];
}

export interface PlexSourceContext {
  sourceId: string;
  baseUrl: string;
  token: string;
}

export function getPlexAuthCompleteUrl() {
  const appUrl = getPublicAppUrl();
  appUrl.pathname = PLEX_AUTH_COMPLETE_PATH;
  appUrl.search = "";
  appUrl.hash = "";
  return appUrl.toString();
}

function plexHeaders(init?: ConstructorParameters<typeof Headers>[0]) {
  const headers = new Headers(init);
  headers.set("Accept", "application/json");
  headers.set("X-Plex-Product", PLEX_PRODUCT);
  headers.set("X-Plex-Client-Identifier", PLEX_CLIENT_IDENTIFIER);
  return headers;
}

export function plexMediaHeaders(init?: ConstructorParameters<typeof Headers>[0]) {
  const headers = plexHeaders(init);
  headers.delete("Accept");
  headers.set("X-Plex-Device", "Browser");
  headers.set("X-Plex-Model", "Cliparr");
  headers.set("X-Plex-Platform", "Web");
  headers.set("X-Plex-Client-Profile-Name", "generic");
  return headers;
}

export async function plexFetch(url: string, init: RequestInit = {}) {
  const headers = plexHeaders(init.headers);

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new ApiError(
      response.status,
      "plex_request_failed",
      `Plex request failed: ${response.status} ${response.statusText}`
    );
  }

  return response;
}

function assertHttpUrl(uri: string) {
  const parsed = new URL(uri);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiError(400, "invalid_connection_url", "Plex connection must use HTTP or HTTPS");
  }

  return parsed;
}

function normalizeProvides(provides: unknown): string[] {
  if (Array.isArray(provides)) {
    return provides
      .flatMap((value) => normalizeProvides(value))
      .filter((value, index, values) => values.indexOf(value) === index);
  }

  if (typeof provides !== "string") {
    return [];
  }

  return provides
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminServerResource(resource: PlexResourceResponse) {
  return Boolean(resource.accessToken)
    && resource.owned === true
    && normalizeProvides(resource.provides).includes("server")
    && Boolean(resource.connections?.length);
}

export function normalizeResources(resources: PlexResourceResponse[]): ProviderResource[] {
  return resources
    .filter((resource) => isAdminServerResource(resource))
    .map((resource) => {
      const connections = (resource.connections ?? [])
        .filter((connection) => connection.uri)
        .map((connection) => {
          const uri = connection.uri as string;
          assertHttpUrl(uri);
          return {
            id: randomUUID(),
            uri,
            local: Boolean(connection.local),
            relay: Boolean(connection.relay),
            protocol: connection.protocol,
            address: connection.address,
            port: connection.port,
          };
        });

      return {
        id: resource.clientIdentifier ?? resource.machineIdentifier ?? randomUUID(),
        name: resource.name ?? "Plex Media Server",
        product: resource.product,
        platform: resource.platform,
        provides: normalizeProvides(resource.provides),
        owned: resource.owned,
        accessToken: resource.accessToken as string,
        connections,
      };
    })
    .filter((resource) => resource.connections.length > 0);
}

function connectionRank(connection: ProviderResource["connections"][number]) {
  if (connection.local && !connection.relay) {
    return 0;
  }
  if (!connection.relay) {
    return 1;
  }
  return 2;
}

function orderedConnections(resource: ProviderResource, preferredConnectionId: string) {
  return [...resource.connections].sort((left, right) => {
    if (left.id === preferredConnectionId) {
      return -1;
    }
    if (right.id === preferredConnectionId) {
      return 1;
    }
    return connectionRank(left) - connectionRank(right);
  });
}

export function candidateConnections(
  resource: ProviderResource,
  preferredConnectionId: string,
  baseUrlMode: PlexBaseUrlMode
) {
  const ordered = orderedConnections(resource, preferredConnectionId);
  return baseUrlMode === PLEX_BASE_URL_MODE_MANUAL ? ordered.slice(0, 1) : ordered;
}

export function unreachableConnectionMessage(
  resource: ProviderResource,
  failures: string[],
  baseUrlMode: PlexBaseUrlMode
) {
  return baseUrlMode === PLEX_BASE_URL_MODE_MANUAL
    ? `Cliparr could not reach the configured server URL for ${resource.name}. Tried: ${failures.join("; ")}`
    : `Cliparr could not reach any discovered connection for ${resource.name}. Tried: ${failures.join("; ")}`;
}

function sourceConnections(source: MediaSource) {
  const rawConnections = Array.isArray(source.connection.connections) ? source.connection.connections : [];
  return rawConnections.flatMap((candidate) => {
    const uri = stringValue((candidate as any)?.uri);
    if (!uri) {
      return [];
    }

    try {
      assertHttpUrl(uri);
    } catch {
      return [];
    }

    return [{
      id: stringValue((candidate as any)?.id) ?? randomUUID(),
      uri,
      local: Boolean((candidate as any)?.local),
      relay: Boolean((candidate as any)?.relay),
      protocol: stringValue((candidate as any)?.protocol),
      address: stringValue((candidate as any)?.address),
      port: numberValue((candidate as any)?.port),
    }];
  });
}

function manualConnectionId(sourceId: string) {
  return `manual-base-url:${sourceId}`;
}

function manualConnection(source: MediaSource) {
  if (plexBaseUrlMode(source.connection) !== PLEX_BASE_URL_MODE_MANUAL) {
    return undefined;
  }

  const parsed = assertHttpUrl(source.baseUrl);
  return {
    id: manualConnectionId(source.id),
    uri: source.baseUrl,
    local: false,
    relay: false,
    protocol: parsed.protocol.replace(/:$/, ""),
    address: parsed.hostname,
    port: parsed.port
      ? Number(parsed.port)
      : parsed.protocol === "https:"
        ? 443
        : 80,
  };
}

export function sourceResource(source: MediaSource) {
  const accessToken = stringValue(source.credentials.accessToken);
  if (!accessToken) {
    throw new ApiError(500, "source_credentials_missing", "Stored Plex source is missing its access token");
  }

  const provides = normalizeProvides(source.metadata.provides);
  if (source.metadata.owned !== true || !provides.includes("server")) {
    throw new ApiError(
      500,
      "source_configuration_invalid",
      "Stored Plex source must be an owned server resource"
    );
  }

  const manual = manualConnection(source);
  const connections = sourceConnections(source);
  if (connections.length === 0 && !manual) {
    throw new ApiError(500, "source_connections_missing", "Stored Plex source is missing connection details");
  }

  const selectedConnectionId = stringValue(source.connection.selectedConnectionId);
  const matchingSelectedConnection = selectedConnectionId
    ? connections.find((candidate) => candidate.id === selectedConnectionId)
    : undefined;
  const matchingBaseUrl = connections.find((candidate) => candidate.uri === source.baseUrl);
  const resourceConnections = manual && !matchingBaseUrl ? [manual, ...connections] : connections;
  const baseUrlMode: PlexBaseUrlMode = manual ? PLEX_BASE_URL_MODE_MANUAL : PLEX_BASE_URL_MODE_AUTO;
  const preferredConnectionId = manual
    ? matchingBaseUrl?.id ?? manual.id
    : matchingSelectedConnection?.id ?? matchingBaseUrl?.id ?? connections[0]?.id;

  if (!preferredConnectionId) {
    throw new ApiError(500, "source_connections_missing", "Stored Plex source is missing connection details");
  }

  return {
    baseUrlMode,
    manualConnectionId: manual?.id,
    persistedConnections: connections,
    preferredConnectionId,
    resource: {
      id: source.externalId ?? source.id,
      name: source.name,
      product: stringValue(source.metadata.product),
      platform: stringValue(source.metadata.platform),
      provides,
      owned: Boolean(source.metadata.owned),
      accessToken,
      connections: resourceConnections,
    } satisfies ProviderResource,
  };
}

export function sourceSupportsCurrentlyPlaying(source: MediaSource) {
  return source.metadata.owned === true && normalizeProvides(source.metadata.provides).includes("server");
}

async function probeConnection(resource: ProviderResource, connection: ProviderResource["connections"][number]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONNECTION_PROBE_TIMEOUT_MS);

  try {
    const url = new URL("/identity", connection.uri);
    const response = await fetch(url.toString(), {
      headers: plexHeaders({
        "X-Plex-Token": resource.accessToken,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false as const,
        message: `${response.status} ${response.statusText}`,
      };
    }

    return { ok: true as const };
  } catch (err) {
    return {
      ok: false as const,
      message: errorMessage(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function selectReachableConnection(
  resource: ProviderResource,
  preferredConnectionId: string,
  options: { baseUrlMode?: PlexBaseUrlMode } = {}
) {
  const failures: string[] = [];
  const baseUrlMode = options.baseUrlMode ?? PLEX_BASE_URL_MODE_AUTO;

  for (const connection of candidateConnections(
    resource,
    preferredConnectionId,
    baseUrlMode
  )) {
    const result = await probeConnection(resource, connection);
    if (result.ok) {
      return connection;
    }

    failures.push(`${connection.uri}: ${result.message}`);
  }

  throw new ApiError(
    502,
    "plex_unreachable",
    unreachableConnectionMessage(resource, failures, baseUrlMode)
  );
}

export function buildSourceContext(
  sourceId: string,
  token: string,
  connection: ProviderResource["connections"][number]
): PlexSourceContext {
  return {
    sourceId,
    baseUrl: connection.uri,
    token,
  };
}

export async function fetchPmsJson(
  context: PlexSourceContext,
  path: string,
  options: { timeoutMs?: number } = {}
) {
  const url = new URL(normalizeMediaPath(path), context.baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS
  );

  try {
    const response = await plexFetch(url.toString(), {
      headers: {
        "X-Plex-Token": context.token,
      },
      signal: controller.signal,
    });
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}
