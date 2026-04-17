import { randomUUID } from "crypto";
import { Readable } from "stream";
import type { Response } from "express";
import { updateMediaSource, type MediaSource } from "../../db/mediaSourcesRepository.js";
import { ApiError } from "../../http/errors.js";
import type {
  CurrentlyPlayingEntry,
  ProviderImplementation,
  ProviderResource,
  MediaExportMetadata,
  MediaHandle,
} from "../types.js";
import type { ProviderSessionRecord } from "../../session/store.js";

const PLEX_PRODUCT = "Cliparr";
const PLEX_CLIENT_IDENTIFIER = process.env.PLEX_CLIENT_IDENTIFIER ?? `cliparr-${randomUUID()}`;
const AUTH_TTL_MS = 1000 * 60 * 10;
const MAX_PENDING_AUTH_REQUESTS = 512;
const DEFAULT_APP_URL = "http://localhost:3000";
const PLEX_AUTH_COMPLETE_PATH = "/auth/plex/complete";
const CONNECTION_PROBE_TIMEOUT_MS = 2500;
const CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS = 5000;

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

interface PlexSourceContext {
  sourceId: string;
  baseUrl: string;
  token: string;
}

function pruneExpiredAuthRequests(now = Date.now()) {
  for (const [authId, authRequest] of authRequests.entries()) {
    if (authRequest.expiresAt <= now) {
      authRequests.delete(authId);
    }
  }
}

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

function normalizeResources(resources: PlexResourceResponse[]): ProviderResource[] {
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

function errorMessage(err: unknown) {
  if (err instanceof Error) {
    return err.message;
  }
  return "Unknown error";
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

function sourceResource(source: MediaSource) {
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

  const connections = sourceConnections(source);
  if (connections.length === 0) {
    throw new ApiError(500, "source_connections_missing", "Stored Plex source is missing connection details");
  }

  const selectedConnectionId = stringValue(source.connection.selectedConnectionId);
  const matchingSelectedConnection = selectedConnectionId
    ? connections.find((candidate) => candidate.id === selectedConnectionId)
    : undefined;
  const matchingBaseUrl = connections.find((candidate) => candidate.uri === source.baseUrl);
  const preferredConnectionId = matchingSelectedConnection?.id ?? matchingBaseUrl?.id ?? connections[0]?.id;

  if (!preferredConnectionId) {
    throw new ApiError(500, "source_connections_missing", "Stored Plex source is missing connection details");
  }

  return {
    preferredConnectionId,
    resource: {
      id: source.externalId ?? source.id,
      name: source.name,
      product: stringValue(source.metadata.product),
      platform: stringValue(source.metadata.platform),
      provides,
      owned: Boolean(source.metadata.owned),
      accessToken,
      connections,
    } satisfies ProviderResource,
  };
}

function sourceSupportsCurrentlyPlaying(source: MediaSource) {
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
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    return path;
  }

  if (!path.startsWith("/")) {
    return `/${path}`;
  }
  return path;
}

function createMediaHandle(
  session: ProviderSessionRecord,
  context: PlexSourceContext,
  path: string,
  options: { basePath?: string } = {}
) {
  const normalizedPath = mediaPath(path);
  const normalizedBasePath = options.basePath ? mediaPath(options.basePath) : undefined;
  const accessedAt = Date.now();

  for (const existingHandle of session.mediaHandles.values()) {
    if (
      existingHandle.providerId === "plex"
      && existingHandle.sourceId === context.sourceId
      && existingHandle.baseUrl === context.baseUrl
      && existingHandle.path === normalizedPath
      && existingHandle.token === context.token
      && existingHandle.basePath === normalizedBasePath
    ) {
      existingHandle.lastAccessedAt = accessedAt;
      return `/api/media/${existingHandle.id}`;
    }
  }

  const handle: MediaHandle = {
    id: randomUUID(),
    providerId: "plex",
    sourceId: context.sourceId,
    baseUrl: context.baseUrl,
    path: normalizedPath,
    token: context.token,
    basePath: normalizedBasePath,
    lastAccessedAt: accessedAt,
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

interface PlexMediaSelection {
  mediaId?: string;
  mediaIndex?: number;
  partId?: string;
  partIndex?: number;
}

function idValue(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  return undefined;
}

function isSelectedEntry(entry: any) {
  return entry?.selected === true || entry?.selected === 1 || entry?.selected === "1";
}

function mediaEntries(item: any) {
  return asArray(item?.Media);
}

function partEntries(media: any) {
  return asArray(media?.Part);
}

function selectedIndex(entries: any[]) {
  const index = entries.findIndex((entry) => isSelectedEntry(entry));
  return index >= 0 ? index : 0;
}

function deriveMediaSelection(item: any): PlexMediaSelection | undefined {
  const media = mediaEntries(item);
  if (media.length === 0) {
    return undefined;
  }

  const mediaIndex = selectedIndex(media);
  const selectedMedia = media[mediaIndex];
  const parts = partEntries(selectedMedia);
  const partIndex = parts.length > 0 ? selectedIndex(parts) : undefined;
  const selectedPart = partIndex === undefined ? undefined : parts[partIndex];

  return {
    mediaId: idValue(selectedMedia?.id),
    mediaIndex,
    partId: idValue(selectedPart?.id),
    partIndex,
  };
}

function resolveSelectedPart(item: any, selection?: PlexMediaSelection) {
  const media = mediaEntries(item);
  if (media.length === 0) {
    return undefined;
  }

  let mediaIndex = selection?.mediaId
    ? media.findIndex((entry) => idValue(entry?.id) === selection.mediaId)
    : -1;
  if (mediaIndex < 0 && selection?.mediaIndex !== undefined && media[selection.mediaIndex]) {
    mediaIndex = selection.mediaIndex;
  }
  if (mediaIndex < 0) {
    mediaIndex = selectedIndex(media);
  }

  const selectedMedia = media[mediaIndex];
  const parts = partEntries(selectedMedia);
  if (parts.length === 0) {
    return {
      media: selectedMedia,
      mediaIndex,
      part: undefined,
      partIndex: 0,
    };
  }

  let partIndex = selection?.partId
    ? parts.findIndex((entry) => idValue(entry?.id) === selection.partId)
    : -1;
  if (partIndex < 0 && selection?.partIndex !== undefined && parts[selection.partIndex]) {
    partIndex = selection.partIndex;
  }
  if (partIndex < 0) {
    partIndex = selectedIndex(parts);
  }

  return {
    media: selectedMedia,
    mediaIndex,
    part: parts[partIndex],
    partIndex,
  };
}

function createPreviewPath(item: any, selection?: PlexMediaSelection) {
  const path = metadataPath(item);
  if (!path) {
    return undefined;
  }

  const resolvedSelection = resolveSelectedPart(item, selection);
  const transcodeSessionId = randomUUID();
  const params = new URLSearchParams({
    path,
    transcodeSessionId,
    protocol: "hls",
    directPlay: "0",
    directStream: "0",
    directStreamAudio: "0",
    mediaIndex: String(resolvedSelection?.mediaIndex ?? 0),
    partIndex: String(resolvedSelection?.partIndex ?? 0),
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

async function fetchPmsJson(
  context: PlexSourceContext,
  path: string,
  options: { timeoutMs?: number } = {}
) {
  const url = new URL(mediaPath(path), context.baseUrl);
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

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function stringValue(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function numberValue(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return undefined;
  }

  return Math.trunc(number);
}

function uniqueStrings(values: (string | undefined)[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

function isRetryableConnectionError(err: unknown) {
  if (!(err instanceof ApiError)) {
    return true;
  }

  return err.code === "plex_request_failed" && err.status !== 401 && err.status !== 403;
}

function buildSourceContext(
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

function persistWorkingSourceConnection(
  source: MediaSource,
  resource: ProviderResource,
  connection: ProviderResource["connections"][number]
) {
  if (
    source.baseUrl === connection.uri
    && stringValue(source.connection.selectedConnectionId) === connection.id
  ) {
    return;
  }

  updateMediaSource(source.id, {
    baseUrl: connection.uri,
    connection: {
      ...source.connection,
      connections: resource.connections,
      selectedConnectionId: connection.id,
    },
  });
}

async function fetchCurrentlyPlayingData(source: MediaSource) {
  const { resource, preferredConnectionId } = sourceResource(source);
  const failures: string[] = [];

  for (const connection of orderedConnections(resource, preferredConnectionId)) {
    const context = buildSourceContext(source.id, resource.accessToken, connection);

    try {
      const data = await fetchPmsJson(context, "/status/sessions", {
        timeoutMs: CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
      });
      persistWorkingSourceConnection(source, resource, connection);
      return { context, data };
    } catch (err) {
      if (!isRetryableConnectionError(err)) {
        throw err;
      }

      failures.push(`${connection.uri}: ${errorMessage(err)}`);
    }
  }

  throw new ApiError(
    502,
    "plex_unreachable",
    `Cliparr could not reach any discovered connection for ${resource.name}. Tried: ${failures.join("; ")}`
  );
}

function tagValues(value: unknown) {
  return uniqueStrings(
    asArray(value as any).map((entry: any) => {
      if (typeof entry === "string") {
        return stringValue(entry);
      }

      return stringValue(entry?.tag) ?? stringValue(entry?.id) ?? stringValue(entry?.ratingKey);
    })
  );
}

function formatEpisodeCode(seasonNumber?: number, episodeNumber?: number) {
  const season = seasonNumber === undefined ? undefined : `S${String(seasonNumber).padStart(2, "0")}`;
  const episode = episodeNumber === undefined ? undefined : `E${String(episodeNumber).padStart(2, "0")}`;

  if (season && episode) {
    return `${season}${episode}`;
  }

  return season ?? episode;
}

function metadataImagePath(item: any) {
  if (item?.type === "episode") {
    return stringValue(item.grandparentThumb) ?? stringValue(item.parentThumb) ?? stringValue(item.thumb);
  }

  return stringValue(item?.thumb) ?? stringValue(item?.grandparentThumb) ?? stringValue(item?.parentThumb);
}

function buildSourceTitle(item: any) {
  const title = stringValue(item?.title);
  if (item?.type !== "episode") {
    return title;
  }

  const showTitle = stringValue(item.grandparentTitle);
  const episodeCode = formatEpisodeCode(numberValue(item.parentIndex), numberValue(item.index));
  return uniqueStrings([showTitle, episodeCode, title]).join(" - ") || title;
}

async function fetchMetadataItem(context: PlexSourceContext, item: any) {
  const path = metadataPath(item);
  if (!path) {
    return undefined;
  }

  const data = await fetchPmsJson(context, path) as any;
  return data?.MediaContainer?.Metadata?.[0];
}

async function enrichMetadataItem(context: PlexSourceContext, item: any) {
  try {
    const fullItem = await fetchMetadataItem(context, item);
    if (!fullItem) {
      return item;
    }

    return {
      ...item,
      ...fullItem,
      User: item.User,
      Player: item.Player,
      Session: item.Session,
    };
  } catch (err) {
    console.warn(`Could not fetch metadata for ${metadataPath(item) ?? "Plex item"}:`, errorMessage(err));
    return item;
  }
}

function createExportMetadata(
  session: ProviderSessionRecord,
  context: PlexSourceContext,
  item: any
): MediaExportMetadata {
  const imagePath = metadataImagePath(item);
  const guid = stringValue(item?.guid);

  return {
    providerId: "plex",
    itemType: stringValue(item?.type) ?? "video",
    title: stringValue(item?.title),
    sourceTitle: buildSourceTitle(item),
    showTitle: stringValue(item?.grandparentTitle),
    seasonTitle: stringValue(item?.parentTitle),
    seasonNumber: numberValue(item?.parentIndex),
    episodeNumber: numberValue(item?.index),
    year: numberValue(item?.year),
    date: stringValue(item?.originallyAvailableAt),
    description: stringValue(item?.summary),
    tagline: stringValue(item?.tagline),
    studio: stringValue(item?.studio),
    network: stringValue(item?.Network?.title) ?? stringValue(item?.Network?.tag),
    contentRating: stringValue(item?.contentRating),
    genres: tagValues(item?.Genre),
    directors: tagValues(item?.Director),
    writers: tagValues(item?.Writer),
    actors: tagValues(item?.Role).slice(0, 12),
    guids: uniqueStrings([guid, ...tagValues(item?.Guid)]),
    ratingKey: stringValue(item?.ratingKey),
    imageUrl: imagePath ? createMediaHandle(session, context, imagePath) : undefined,
  };
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

async function resolveMediaPath(
  context: PlexSourceContext,
  item: any,
  enrichedItem?: any,
  selection?: PlexMediaSelection
) {
  const directPath = fallbackPartPath(resolveSelectedPart(item, selection)?.part);
  if (directPath) {
    return directPath;
  }

  const enrichedPath = fallbackPartPath(resolveSelectedPart(enrichedItem, selection)?.part);
  if (enrichedPath) {
    return enrichedPath;
  }

  const path = metadataPath(item);
  if (!path) {
    return undefined;
  }

  try {
    const data = await fetchPmsJson(context, path) as any;
    const fullItem = data?.MediaContainer?.Metadata?.[0];
    return fallbackPartPath(resolveSelectedPart(fullItem, selection)?.part);
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
  handle: MediaHandle,
  basePath: string,
  uri: string
) {
  const nextPath = resolvePlaylistUri(basePath, uri);
  return createMediaHandle(session, {
    sourceId: handle.sourceId,
    baseUrl: handle.baseUrl,
    token: handle.token,
  }, nextPath, {
    basePath: playlistBasePath(nextPath),
  });
}

async function rewriteHlsPlaylist(
  session: ProviderSessionRecord,
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
          return `URI="${rewritePlaylistUri(session, handle, basePath, uri)}"`;
        });
      }

      return rewritePlaylistUri(session, handle, basePath, trimmed);
    })
    .join("\n");
}

function playbackSessionIdentity(item: any) {
  return String(
    item?.Session?.id
    ?? item?.ratingKey
    ?? item?.key
    ?? item?.Player?.machineIdentifier
    ?? randomUUID()
  );
}

function playbackViewer(item: any, sourceId: string, sessionId: string) {
  const externalId = stringValue(item?.User?.id);
  return {
    id: externalId ? `plex:user:${externalId}` : `plex:synthetic:${sourceId}:${sessionId}`,
    providerId: "plex" as const,
    externalId,
    name: stringValue(item?.User?.title) ?? "Unknown User",
    avatarUrl: stringValue(item?.User?.thumb),
  };
}

async function normalizeCurrentPlayback(
  session: ProviderSessionRecord,
  source: MediaSource,
  context: PlexSourceContext,
  data: any
): Promise<CurrentlyPlayingEntry[]> {
  const metadata = data?.MediaContainer?.Metadata;
  if (!Array.isArray(metadata)) {
    return [];
  }

  return Promise.all(metadata.map(async (item: any) => {
    const mediaSelection = deriveMediaSelection(item);
    const enrichedItem = await enrichMetadataItem(context, item);
    const mediaPath = await resolveMediaPath(context, item, enrichedItem, mediaSelection);
    const previewPath = createPreviewPath(enrichedItem, mediaSelection);
    const thumbPath = metadataImagePath(enrichedItem);
    const sessionId = playbackSessionIdentity(item);

    return {
      viewer: playbackViewer(item, source.id, sessionId),
      item: {
        id: `${source.id}:${sessionId}`,
        source: {
          id: source.id,
          name: source.name,
          providerId: "plex",
        },
        title: String(enrichedItem.title ?? "Untitled"),
        type: String(enrichedItem.type ?? "video"),
        duration: Number(enrichedItem.duration ?? asArray(enrichedItem.Media)[0]?.duration ?? 0) / 1000,
        playerTitle: String(item.Player?.title ?? "Unknown Device"),
        playerState: String(item.Player?.state ?? "unknown"),
        thumbUrl: thumbPath ? createMediaHandle(session, context, thumbPath) : undefined,
        mediaUrl: mediaPath ? createMediaHandle(session, context, mediaPath) : undefined,
        previewUrl: previewPath ? createMediaHandle(session, context, previewPath) : undefined,
        exportMetadata: createExportMetadata(session, context, enrichedItem),
      },
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
    pruneExpiredAuthRequests();
    if (authRequests.size >= MAX_PENDING_AUTH_REQUESTS) {
      throw new ApiError(503, "plex_auth_busy", "Too many pending Plex sign-ins. Wait a moment and try again.");
    }

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
    pruneExpiredAuthRequests();
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

  supportsCurrentlyPlayingSource(source) {
    return sourceSupportsCurrentlyPlaying(source);
  },

  async checkSource(source) {
    const { resource, preferredConnectionId } = sourceResource(source);
    try {
      const selectedConnection = await selectReachableConnection(resource, preferredConnectionId);

      return {
        ok: true,
        baseUrl: selectedConnection.uri,
        connection: {
          ...source.connection,
          connections: resource.connections,
          selectedConnectionId: selectedConnection.id,
        },
      };
    } catch (err) {
      if (err instanceof ApiError && err.code === "plex_unreachable") {
        return {
          ok: false,
          message: err.message,
        };
      }

      throw err;
    }
  },

  async listCurrentlyPlaying(session, source) {
    const { context, data } = await fetchCurrentlyPlayingData(source);
    return normalizeCurrentPlayback(session, source, context, data);
  },

  async proxyMedia(session, handleId, req, res) {
    const handle = session.mediaHandles.get(handleId);
    if (!handle) {
      throw new ApiError(404, "media_not_found", "Media handle was not found or has expired");
    }
    handle.lastAccessedAt = Date.now();

    const url = new URL(handle.path, handle.baseUrl);
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
      const playlist = await rewriteHlsPlaylist(session, handle, upstream);
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
    return {
      id: session.id,
      providerId: "plex",
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  },
};
