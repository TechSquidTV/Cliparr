import { randomUUID } from "crypto";
import { Readable } from "stream";
import type { Request, Response } from "express";
import { ApiError } from "../../http/errors.js";
import type { ProviderImplementation, ProviderResource, MediaHandle, MediaSession } from "../types.js";
import type { ProviderSessionRecord } from "../../session/store.js";

const PLEX_PRODUCT = "Cliparr";
const PLEX_CLIENT_IDENTIFIER = process.env.PLEX_CLIENT_IDENTIFIER ?? `cliparr-${randomUUID()}`;
const AUTH_TTL_MS = 1000 * 60 * 10;
const DEFAULT_APP_URL = "http://localhost:3000";
const PLEX_AUTH_COMPLETE_PATH = "/auth/plex/complete";

interface PlexAuthRequest {
  authId: string;
  pinId: number;
  code: string;
  expiresAt: number;
}

interface PlexResourceResponse {
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

const authRequests = new Map<string, PlexAuthRequest>();

function getPlexAuthCompleteUrl() {
  const appUrl = new URL(process.env.APP_URL ?? DEFAULT_APP_URL);
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

function plexMediaHeaders(init?: ConstructorParameters<typeof Headers>[0]) {
  const headers = plexHeaders(init);
  headers.delete("Accept");
  headers.set("X-Plex-Device", "Browser");
  headers.set("X-Plex-Model", "Cliparr");
  headers.set("X-Plex-Platform", "Web");
  headers.set("X-Plex-Client-Profile-Name", "generic");
  return headers;
}

async function plexFetch(url: string, init: RequestInit = {}) {
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

function normalizeResources(resources: PlexResourceResponse[]): ProviderResource[] {
  return resources
    .filter((resource) => resource.accessToken && resource.connections?.length)
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
        owned: resource.owned,
        accessToken: resource.accessToken as string,
        connections,
      };
    })
    .filter((resource) => resource.connections.length > 0);
}

function publicResource(resource: ProviderResource) {
  const { accessToken, ...safeResource } = resource;
  return safeResource;
}

function selectedResource(session: ProviderSessionRecord) {
  const resource = session.selectedResource as ProviderResource | undefined;
  if (!resource) {
    throw new ApiError(409, "resource_not_selected", "Select a Plex server before loading media");
  }
  return resource;
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

function errorMessage(err: unknown) {
  if (err instanceof Error) {
    return err.message;
  }
  return "Unknown error";
}

async function probeConnection(resource: ProviderResource, connection: ProviderResource["connections"][number]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

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

async function selectReachableConnection(resource: ProviderResource, preferredConnectionId: string) {
  const failures: string[] = [];

  for (const connection of orderedConnections(resource, preferredConnectionId)) {
    const result = await probeConnection(resource, connection);
    if (result.ok) {
      return connection;
    }

    failures.push(`${connection.uri}: ${result.message}`);
  }

  throw new ApiError(
    502,
    "plex_unreachable",
    `Cliparr could not reach any discovered connection for ${resource.name}. Tried: ${failures.join("; ")}`
  );
}

function mediaPath(path: string) {
  if (!path.startsWith("/")) {
    return `/${path}`;
  }
  return path;
}

function createMediaHandle(
  session: ProviderSessionRecord,
  resource: ProviderResource,
  path: string,
  options: { basePath?: string } = {}
) {
  const handle: MediaHandle = {
    id: randomUUID(),
    providerId: "plex",
    resourceId: resource.id,
    path: mediaPath(path),
    token: resource.accessToken,
    basePath: options.basePath ? mediaPath(options.basePath) : undefined,
  };
  session.mediaHandles.set(handle.id, handle);
  return `/api/media/${handle.id}`;
}

function metadataPath(item: any) {
  if (item?.ratingKey) {
    return `/library/metadata/${item.ratingKey}`;
  }
  if (typeof item?.key === "string" && item.key.startsWith("/library/metadata/")) {
    return item.key;
  }
  return undefined;
}

function createPreviewPath(item: any) {
  const path = metadataPath(item);
  if (!path) {
    return undefined;
  }

  const transcodeSessionId = randomUUID();
  const params = new URLSearchParams({
    path,
    transcodeSessionId,
    protocol: "hls",
    directPlay: "0",
    directStream: "0",
    directStreamAudio: "0",
    mediaIndex: "0",
    partIndex: "0",
    audioChannelCount: "2",
    subtitles: "none",
    videoQuality: "80",
    videoResolution: "1920x1080",
    videoBitrate: "12000",
    peakBitrate: "12000",
    location: "lan",
    mediaBufferSize: "102400",
  });

  return `/video/:/transcode/universal/start.m3u8?${params.toString()}`;
}

function transcodeSessionId(path: string) {
  try {
    return new URL(path, "http://cliparr.local").searchParams.get("transcodeSessionId");
  } catch {
    return null;
  }
}

async function fetchPmsJson(resource: ProviderResource, path: string) {
  const baseUrl = resource.connections[0].uri;
  const url = new URL(mediaPath(path), baseUrl);
  const response = await plexFetch(url.toString(), {
    headers: {
      "X-Plex-Token": resource.accessToken,
    },
  });
  return response.json();
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function firstPart(item: any) {
  return asArray(item?.Media)[0] ? asArray(asArray(item.Media)[0]?.Part)[0] : undefined;
}

function fallbackPartPath(part: any) {
  if (!part?.id) {
    return undefined;
  }

  if (typeof part.key === "string" && part.key) {
    return part.key;
  }

  if (part.file) {
    const filename = String(part.file).split(/[\\/]/).pop() || "file";
    const changestamp = part.updatedAt ?? part.createdAt;
    if (changestamp) {
      return `/library/parts/${part.id}/${changestamp}/${encodeURIComponent(filename)}`;
    }
    return `/library/parts/${part.id}/${encodeURIComponent(filename)}`;
  }

  return `/library/parts/${part.id}/file`;
}

async function resolveMediaPath(resource: ProviderResource, item: any) {
  const directPath = fallbackPartPath(firstPart(item));
  if (directPath) {
    return directPath;
  }

  const path = metadataPath(item);
  if (!path) {
    return undefined;
  }

  try {
    const data = await fetchPmsJson(resource, path) as any;
    const fullItem = data?.MediaContainer?.Metadata?.[0];
    return fallbackPartPath(firstPart(fullItem));
  } catch (err) {
    console.warn(`Could not resolve media part for ${path}:`, errorMessage(err));
    return undefined;
  }
}

function playlistBasePath(path: string) {
  const withoutQuery = path.split("?")[0];
  const lastSlash = withoutQuery.lastIndexOf("/");
  return lastSlash >= 0 ? withoutQuery.slice(0, lastSlash + 1) : "/";
}

function resolvePlaylistUri(basePath: string, uri: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) {
    const parsed = new URL(uri);
    return `${parsed.pathname}${parsed.search}`;
  }

  if (uri.startsWith("/")) {
    return uri;
  }

  const parsed = new URL(uri, `http://cliparr.local${basePath}`);
  return `${parsed.pathname}${parsed.search}`;
}

function rewritePlaylistUri(
  session: ProviderSessionRecord,
  resource: ProviderResource,
  basePath: string,
  uri: string
) {
  const nextPath = resolvePlaylistUri(basePath, uri);
  return createMediaHandle(session, resource, nextPath, {
    basePath: playlistBasePath(nextPath),
  });
}

async function rewriteHlsPlaylist(
  session: ProviderSessionRecord,
  resource: ProviderResource,
  handle: MediaHandle,
  upstream: globalThis.Response
) {
  const body = await upstream.text();
  const basePath = handle.basePath ?? playlistBasePath(handle.path);

  return body
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return line;
      }

      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
          return `URI="${rewritePlaylistUri(session, resource, basePath, uri)}"`;
        });
      }

      return rewritePlaylistUri(session, resource, basePath, trimmed);
    })
    .join("\n");
}

async function normalizeMediaSessions(session: ProviderSessionRecord, resource: ProviderResource, data: any): Promise<MediaSession[]> {
  const metadata = data?.MediaContainer?.Metadata;
  if (!Array.isArray(metadata)) {
    return [];
  }

  return Promise.all(metadata.map(async (item: any) => {
    const mediaPath = await resolveMediaPath(resource, item);
    const previewPath = createPreviewPath(item);
    return {
      id: String(item.Session?.id ?? item.key ?? item.ratingKey ?? randomUUID()),
      title: String(item.title ?? "Untitled"),
      type: String(item.type ?? "video"),
      duration: Number(item.duration ?? asArray(item.Media)[0]?.duration ?? 0) / 1000,
      userTitle: String(item.User?.title ?? "Unknown User"),
      playerTitle: String(item.Player?.title ?? "Unknown Device"),
      playerState: String(item.Player?.state ?? "unknown"),
      thumbUrl: item.thumb ? createMediaHandle(session, resource, item.thumb) : undefined,
      mediaUrl: mediaPath ? createMediaHandle(session, resource, mediaPath) : undefined,
      previewUrl: previewPath ? createMediaHandle(session, resource, previewPath) : undefined,
    };
  }));
}

function copyProxyHeaders(upstream: globalThis.Response, res: Response) {
  const allowed = [
    "accept-ranges",
    "cache-control",
    "content-disposition",
    "content-length",
    "content-range",
    "content-type",
    "etag",
    "last-modified",
  ];

  for (const header of allowed) {
    const value = upstream.headers.get(header);
    if (value) {
      res.setHeader(header, value);
    }
  }

  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

function isHlsPlaylist(handle: MediaHandle, contentType: string) {
  const normalizedContentType = contentType.toLowerCase();
  if (normalizedContentType.includes("mpegurl")) {
    return true;
  }

  try {
    return new URL(handle.path, "http://cliparr.local").pathname.endsWith(".m3u8");
  } catch {
    return handle.path.split("?")[0].endsWith(".m3u8");
  }
}

export const plexProvider: ProviderImplementation = {
  definition: {
    id: "plex",
    name: "Plex",
    auth: "pin",
  },

  async startAuth() {
    const response = await plexFetch("https://plex.tv/api/v2/pins?strong=true", {
      method: "POST",
    });
    const data = (await response.json()) as { id: number; code: string; expiresIn?: number };

    if (!data.id || !data.code) {
      throw new ApiError(502, "plex_auth_start_failed", "Plex did not return a PIN");
    }

    const authId = randomUUID();
    const expiresAt = Date.now() + (data.expiresIn ? data.expiresIn * 1000 : AUTH_TTL_MS);
    authRequests.set(authId, {
      authId,
      pinId: data.id,
      code: data.code,
      expiresAt,
    });

    const authUrl = new URL("https://app.plex.tv/auth");
    authUrl.hash = `?${new URLSearchParams({
      clientID: PLEX_CLIENT_IDENTIFIER,
      code: data.code,
      forwardUrl: getPlexAuthCompleteUrl(),
      "context[device][product]": PLEX_PRODUCT,
    }).toString()}`;

    return {
      authId,
      authUrl: authUrl.toString(),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  },

  async pollAuth(authId) {
    const authRequest = authRequests.get(authId);
    if (!authRequest) {
      return { status: "expired" as const };
    }

    if (authRequest.expiresAt <= Date.now()) {
      authRequests.delete(authId);
      return { status: "expired" as const };
    }

    const response = await plexFetch(`https://plex.tv/api/v2/pins/${authRequest.pinId}`);
    const data = (await response.json()) as { authToken?: string; auth_token?: string };
    const userToken = data.authToken ?? data.auth_token;

    if (!userToken) {
      return { status: "pending" as const };
    }

    const resourcesResponse = await plexFetch(
      "https://clients.plex.tv/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=1",
      {
        headers: {
          "X-Plex-Token": userToken,
        },
      }
    );
    const resources = normalizeResources((await resourcesResponse.json()) as PlexResourceResponse[]);
    authRequests.delete(authId);

    return {
      status: "complete" as const,
      userToken,
      resources,
    };
  },

  async selectResource(session, resourceId, connectionId) {
    const resources = session.resources as ProviderResource[];
    const resource = resources.find((candidate) => candidate.id === resourceId);
    if (!resource) {
      throw new ApiError(404, "resource_not_found", "Plex server was not found in this session");
    }

    const connection = resource.connections.find((candidate) => candidate.id === connectionId);
    if (!connection) {
      throw new ApiError(404, "connection_not_found", "Plex connection was not found in this session");
    }

    const selectedConnection = await selectReachableConnection(resource, connectionId);
    const selected = {
      ...resource,
      connections: [selectedConnection],
    };
    session.selectedResource = selected;
    session.mediaHandles.clear();
    return selected;
  },

  async listMediaSessions(session) {
    const resource = selectedResource(session);
    const data = await fetchPmsJson(resource, "/status/sessions");
    return normalizeMediaSessions(session, resource, data);
  },

  async proxyMedia(session, handleId, req, res) {
    const handle = session.mediaHandles.get(handleId) as MediaHandle | undefined;
    if (!handle) {
      throw new ApiError(404, "media_not_found", "Media handle was not found or has expired");
    }

    const resource = selectedResource(session);
    if (handle.resourceId !== resource.id) {
      throw new ApiError(404, "media_not_found", "Media handle was not found for this server");
    }

    const url = new URL(handle.path, resource.connections[0].uri);
    const headers = plexMediaHeaders({
      "X-Plex-Token": handle.token,
    });

    const accept = req.header("accept");
    const range = req.header("range");
    if (accept) {
      headers.set("Accept", accept);
    }
    if (range) {
      headers.set("Range", range);
    }

    const playbackSessionId = transcodeSessionId(handle.path);
    if (playbackSessionId) {
      headers.set("X-Plex-Session-Identifier", playbackSessionId);
    }

    const upstream = await fetch(url.toString(), { headers });
    if (!upstream.ok && upstream.status !== 206) {
      const detail = (await upstream.text()).slice(0, 400).replace(/\s+/g, " ").trim();
      throw new ApiError(
        upstream.status,
        "plex_media_failed",
        detail ? `Plex media request failed: ${detail}` : "Plex media request failed"
      );
    }

    res.status(upstream.status);
    copyProxyHeaders(upstream, res);

    const contentType = upstream.headers.get("content-type") ?? "";
    if (isHlsPlaylist(handle, contentType)) {
      const playlist = await rewriteHlsPlaylist(session, resource, handle, upstream);
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Content-Length", Buffer.byteLength(playlist));
      res.send(playlist);
      return;
    }

    if (!upstream.body) {
      res.end();
      return;
    }

    Readable.fromWeb(upstream.body as any).pipe(res);
  },

  serializeSession(session) {
    const resource = session.selectedResource as ProviderResource | undefined;
    return {
      id: session.id,
      providerId: "plex",
      selectedResource: resource ? publicResource(resource) : undefined,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  },
};
