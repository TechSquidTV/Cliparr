import { randomUUID } from "node:crypto";

import type { Resource } from "@cliparr/plex/cloud/types";

import type { MediaSourceRecord } from "@/db/mediaSourcesRepository";
import { createApiError } from "@/http/errors";
import {
  PLEX_BASE_URL_MODE_AUTO,
  PLEX_BASE_URL_MODE_MANUAL,
  type PlexBaseUrlMode,
  plexBaseUrlMode,
} from "@/providers/plex/connectionState";
import {
  plexPmsResponseStatusMessage,
  requestPlexPmsCurrentSessions,
  requestPlexPmsIdentity,
  requestPlexPmsMetadata,
} from "@/providers/plex/pmsClient";
import { connectionRank } from "@/providers/shared/connections";
import {
  assertHttpUrl,
  errorMessage,
  numberValue,
  stringValue,
} from "@/providers/shared/utilities";
import type { ProviderConnection, ProviderResource } from "@/providers/types";

export const PLEX_PRODUCT = "Cliparr";
export const PLEX_CLIENT_IDENTIFIER =
  process.env.PLEX_CLIENT_IDENTIFIER ?? `cliparr-${randomUUID()}`;
export const AUTH_TTL_MS = 1000 * 60 * 10;
export const MAX_PENDING_AUTH_REQUESTS = 512;
export const CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS = 5000;

const CONNECTION_PROBE_TIMEOUT_MS = 2500;
const CONNECTION_ATTEMPT_DELAY_MS = 250;
const MAX_CONCURRENT_CONNECTION_ATTEMPTS = 2;

export interface PlexAuthRequest {
  authId: string;
  pinId: number;
  code: string;
  pollTokenHash: string;
  expiresAt: number;
}

export interface PlexSourceContext {
  sourceId: string;
  baseUrl: string;
  token: string;
}

function plexHeaders(init?: ConstructorParameters<typeof Headers>[0]) {
  const headers = new Headers(init);
  headers.set("Accept", "application/json");
  headers.set("X-Plex-Product", PLEX_PRODUCT);
  headers.set("X-Plex-Client-Identifier", PLEX_CLIENT_IDENTIFIER);
  return headers;
}

export function plexMediaHeaders(
  init?: ConstructorParameters<typeof Headers>[0],
) {
  const headers = plexHeaders(init);
  headers.delete("Accept");
  headers.set("X-Plex-Device", "Browser");
  headers.set("X-Plex-Model", "Cliparr");
  headers.set("X-Plex-Platform", "Web");
  headers.set("X-Plex-Client-Profile-Name", "generic");
  return headers;
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

function isAdminServerResource(
  resource: Resource,
): resource is Resource & Required<Pick<Resource, "accessToken">> {
  // Plex requires an admin token for the /status/sessions endpoint.
  return (
    Boolean(resource.accessToken) &&
    resource.owned === true &&
    normalizeProvides(resource.provides).includes("server") &&
    Boolean(resource.connections?.length)
  );
}

export function normalizeResources(resources: Resource[]): ProviderResource[] {
  return resources
    .filter((resource) => isAdminServerResource(resource))
    .map((resource) => {
      const connections = (resource.connections ?? []).flatMap((connection) => {
        const uri = connection.uri;
        if (!uri) {
          return [];
        }
        assertHttpUrl(uri, "Plex");
        return {
          id: randomUUID(),
          uri,
          local: connection.local === true,
          relay: connection.relay === true,
          protocol: connection.protocol,
          address: connection.address,
          port: connection.port,
        };
      });

      return {
        id: resource.clientIdentifier ?? randomUUID(),
        name: resource.name ?? "Plex Media Server",
        product: resource.product,
        platform: resource.platform,
        provides: normalizeProvides(resource.provides),
        owned: resource.owned === true,
        accessToken: resource.accessToken,
        connections,
      };
    })
    .filter((resource) => resource.connections.length > 0);
}

export function requirePlexServerResources(resources: ProviderResource[]) {
  if (resources.length > 0) {
    return resources;
  }

  throw createApiError(
    403,
    "plex_server_required",
    "Cliparr needs a Plex account that owns at least one Plex Media Server",
  );
}

function orderedConnections(
  resource: ProviderResource,
  preferredConnectionId: string,
) {
  return resource.connections.toSorted((left, right) => {
    if (left.id === preferredConnectionId) {
      return -1;
    }
    if (right.id === preferredConnectionId) {
      return 1;
    }
    return connectionRank(left) - connectionRank(right);
  });
}

function candidateConnections(
  resource: ProviderResource,
  preferredConnectionId: string,
  baseUrlMode: PlexBaseUrlMode,
) {
  const ordered = orderedConnections(resource, preferredConnectionId);
  return baseUrlMode === PLEX_BASE_URL_MODE_MANUAL
    ? ordered.slice(0, 1)
    : ordered;
}

function unreachableConnectionMessage(
  resource: ProviderResource,
  failures: string[],
  baseUrlMode: PlexBaseUrlMode,
) {
  return baseUrlMode === PLEX_BASE_URL_MODE_MANUAL
    ? `Cliparr could not reach the configured server URL for ${resource.name}. Tried: ${failures.join("; ")}`
    : `Cliparr could not reach any discovered connection for ${resource.name}. Tried: ${failures.join("; ")}`;
}

function sourceConnections(source: MediaSourceRecord) {
  const rawConnections: unknown[] = Array.isArray(source.connection.connections)
    ? source.connection.connections
    : [];
  return rawConnections.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return [];
    }

    const connection = candidate as Record<string, unknown>;
    const uri = stringValue(connection.uri);
    if (!uri) {
      return [];
    }

    try {
      assertHttpUrl(uri, "Plex");
    } catch {
      return [];
    }

    return [
      {
        id: stringValue(connection.id) ?? randomUUID(),
        uri,
        local: Boolean(connection.local),
        relay: Boolean(connection.relay),
        protocol: stringValue(connection.protocol),
        address: stringValue(connection.address),
        port: numberValue(connection.port),
      },
    ];
  });
}

function manualConnectionId(sourceId: string) {
  return `manual-base-url:${sourceId}`;
}

function manualConnection(source: MediaSourceRecord) {
  if (plexBaseUrlMode(source.connection) !== PLEX_BASE_URL_MODE_MANUAL) {
    return;
  }

  const parsed = assertHttpUrl(source.baseUrl, "Plex");
  let port = 80;
  if (parsed.port) {
    port = Number(parsed.port);
  } else if (parsed.protocol === "https:") {
    port = 443;
  }

  return {
    id: manualConnectionId(source.id),
    uri: source.baseUrl,
    local: false,
    relay: false,
    protocol: parsed.protocol.replace(/:$/, ""),
    address: parsed.hostname,
    port,
  };
}

export function sourceResource(source: MediaSourceRecord) {
  const accessToken = stringValue(source.credentials.accessToken);
  if (!accessToken) {
    throw createApiError(
      500,
      "source_credentials_missing",
      "Stored Plex source is missing its access token",
    );
  }

  const provides = normalizeProvides(source.metadata.provides);
  if (source.metadata.owned !== true || !provides.includes("server")) {
    throw createApiError(
      500,
      "source_configuration_invalid",
      "Stored Plex source must be an owned server resource",
    );
  }

  const manual = manualConnection(source);
  const connections = sourceConnections(source);
  if (connections.length === 0 && !manual) {
    throw createApiError(
      500,
      "source_connections_missing",
      "Stored Plex source is missing connection details",
    );
  }

  const selectedConnectionId = stringValue(
    source.connection.selectedConnectionId,
  );
  const matchingSelectedConnection = selectedConnectionId
    ? connections.find((candidate) => candidate.id === selectedConnectionId)
    : undefined;
  const matchingBaseUrl = connections.find(
    (candidate) => candidate.uri === source.baseUrl,
  );
  const resourceConnections =
    manual && !matchingBaseUrl ? [manual, ...connections] : connections;
  const baseUrlMode: PlexBaseUrlMode = manual
    ? PLEX_BASE_URL_MODE_MANUAL
    : PLEX_BASE_URL_MODE_AUTO;
  const preferredConnectionId = manual
    ? (matchingBaseUrl?.id ?? manual.id)
    : (matchingSelectedConnection?.id ??
      matchingBaseUrl?.id ??
      connections[0]?.id);

  if (!preferredConnectionId) {
    throw createApiError(
      500,
      "source_connections_missing",
      "Stored Plex source is missing connection details",
    );
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

export function sourceSupportsCurrentlyPlaying(source: MediaSourceRecord) {
  return (
    source.metadata.owned === true &&
    normalizeProvides(source.metadata.provides).includes("server")
  );
}

function plexPmsRequestOptions(timeoutMs: number) {
  return {
    clientIdentifier: PLEX_CLIENT_IDENTIFIER,
    product: PLEX_PRODUCT,
    timeoutMs,
  };
}

export function fetchPmsCurrentSessions(
  context: PlexSourceContext,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
) {
  return requestPlexPmsCurrentSessions(context, {
    ...plexPmsRequestOptions(
      options.timeoutMs ?? CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
    ),
    signal: options.signal,
  });
}

export function fetchPmsMetadata(
  context: PlexSourceContext,
  ids: string[],
  options: { timeoutMs?: number } = {},
) {
  return requestPlexPmsMetadata(
    context,
    ids,
    plexPmsRequestOptions(
      options.timeoutMs ?? CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
    ),
  );
}

/**
Give the preferred address a head start, then try at most two at once.
A speculative fatal error waits for earlier-ranked attempts before failing
selection. Requests must fully consume their response before resolving:
all attempt signals, including the winner's, abort when selection settles.
*/
export function selectPlexConnection<T>(
  resource: ProviderResource,
  preferredConnectionId: string,
  request: (connection: ProviderConnection, signal: AbortSignal) => Promise<T>,
  options: {
    baseUrlMode?: PlexBaseUrlMode;
    signal?: AbortSignal;
    retryable?: (error: unknown) => boolean;
  } = {},
) {
  const baseUrlMode = options.baseUrlMode ?? PLEX_BASE_URL_MODE_AUTO;
  const candidates = candidateConnections(
    resource,
    preferredConnectionId,
    baseUrlMode,
  );
  const controller = new AbortController();
  const failures: string[] = [];

  return new Promise<{ connection: ProviderConnection; data: T }>(
    (resolve, reject) => {
      let nextIndex = 0;
      const active = new Set<number>();
      let fatalFailure: { index: number; error: unknown } | undefined;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        controller.abort();
      };
      const fail = (error: unknown) => {
        if (!settled) {
          cleanup();
          // AbortSignal reasons may be arbitrary values; preserve the caller's reason.
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          reject(error);
        }
      };
      const abort = () => fail(options.signal?.reason);
      const recordFatalFailure = (index: number, error: unknown) => {
        if (!fatalFailure || index < fatalFailure.index) {
          fatalFailure = { index, error };
        }
      };
      const startNext = () => {
        clearTimeout(timer);
        if (settled) {
          return;
        }
        if (fatalFailure) {
          const { index, error } = fatalFailure;
          // Later candidates could not have been reached by the sequential
          // selector. Keep earlier attempts alive, but start no further work.
          if (![...active].some((activeIndex) => activeIndex < index)) {
            fail(error);
          }
          return;
        }
        const index = nextIndex;
        const connection = candidates[index];
        if (!connection) {
          if (active.size === 0) {
            fail(
              createApiError(
                502,
                "plex_unreachable",
                unreachableConnectionMessage(resource, failures, baseUrlMode),
              ),
            );
          }
          return;
        }
        if (active.size >= MAX_CONCURRENT_CONNECTION_ATTEMPTS) {
          return;
        }
        nextIndex++;
        active.add(index);
        if (
          nextIndex < candidates.length &&
          active.size < MAX_CONCURRENT_CONNECTION_ATTEMPTS
        ) {
          timer = setTimeout(startNext, CONNECTION_ATTEMPT_DELAY_MS);
        }
        void (async () => {
          try {
            const data = await request(connection, controller.signal);
            if (!settled) {
              cleanup();
              resolve({ connection, data });
            }
          } catch (error) {
            active.delete(index);
            if (settled) {
              return;
            }
            if (options.retryable && !options.retryable(error)) {
              recordFatalFailure(index, error);
            } else {
              failures[index] =
                `${connection.uri}: ${plexPmsResponseStatusMessage(error) ?? errorMessage(error)}`;
            }
            // Retryable failures free a slot immediately; fatal failures wait
            // for earlier-ranked attempts without starting another candidate.
            startNext();
          }
        })();
      };

      if (options.signal?.aborted) {
        abort();
        return;
      }
      options.signal?.addEventListener("abort", abort, { once: true });
      startNext();
    },
  );
}

export async function selectReachableConnection(
  resource: ProviderResource,
  preferredConnectionId: string,
  options: { baseUrlMode?: PlexBaseUrlMode } = {},
) {
  const { connection } = await selectPlexConnection(
    resource,
    preferredConnectionId,
    (candidate, signal) =>
      requestPlexPmsIdentity(
        { baseUrl: candidate.uri, token: resource.accessToken },
        { ...plexPmsRequestOptions(CONNECTION_PROBE_TIMEOUT_MS), signal },
      ),
    options,
  );
  return connection;
}

export function buildSourceContext(
  sourceId: string,
  token: string,
  connection: ProviderResource["connections"][number],
): PlexSourceContext {
  return {
    sourceId,
    baseUrl: connection.uri,
    token,
  };
}
