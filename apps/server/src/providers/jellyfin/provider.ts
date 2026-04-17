import { createHash, randomUUID } from "crypto";
import { lookup } from "dns/promises";
import { isIP } from "net";
import { Readable } from "stream";
import type { Response } from "express";
import type { MediaSource } from "../../db/mediaSourcesRepository.js";
import { ApiError } from "../../http/errors.js";
import type { ProviderSessionRecord } from "../../session/store.js";
import type {
  CurrentlyPlayingEntry,
  MediaExportMetadata,
  MediaHandle,
  ProviderImplementation,
  ProviderResource,
} from "../types.js";

const JELLYFIN_PRODUCT = "Cliparr";
const JELLYFIN_DEVICE_NAME = "Cliparr";
const JELLYFIN_VERSION = process.env.npm_package_version ?? "0.0.0";
const JELLYFIN_REQUEST_TIMEOUT_MS = 5000;
const CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS = 5000;
const JELLYFIN_DEV_BASE_URL = stringValue(process.env.CLIPARR_DEV_JELLYFIN_URL);
const ALLOW_LOOPBACK_JELLYFIN_URLS = booleanEnv(process.env.CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS);
const DISALLOWED_JELLYFIN_HOSTNAMES = new Set([
  "metadata",
  "metadata.azure.internal",
  "metadata.google.internal",
]);

interface JellyfinSourceContext {
  sourceId: string;
  baseUrl: string;
  token: string;
  userId: string;
  deviceId: string;
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

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function booleanEnv(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
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

function errorMessage(err: unknown) {
  if (err instanceof Error) {
    return err.message;
  }

  return "Unknown error";
}

function deriveJellyfinDeviceId() {
  const configured = stringValue(process.env.JELLYFIN_DEVICE_ID);
  if (configured) {
    return configured;
  }

  const appKey = stringValue(process.env.APP_KEY);
  if (appKey) {
    return `cliparr-${createHash("sha256").update(appKey).digest("hex").slice(0, 32)}`;
  }

  return `cliparr-${randomUUID()}`;
}

const JELLYFIN_DEVICE_ID = deriveJellyfinDeviceId();

function assertHttpUrl(uri: string) {
  const parsed = new URL(uri);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiError(400, "invalid_connection_url", "Jellyfin connection must use HTTP or HTTPS");
  }

  return parsed;
}

function normalizeBaseUrl(url: string) {
  const parsed = assertHttpUrl(url.trim());
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";

  const normalizedPathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${normalizedPathname === "/" ? "" : normalizedPathname}`;
}

function isLoopbackHost(hostname: string) {
  const host = normalizeHostname(hostname);
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

function normalizeIpCandidate(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return normalized.slice(1, -1);
  }

  return normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
}

function normalizeHostname(value: string) {
  return normalizeIpCandidate(value.trim()).replace(/\.+$/, "");
}

function isUnspecifiedHost(hostname: string) {
  const host = normalizeHostname(hostname);
  return host === "0.0.0.0" || host === "::";
}

function isLinkLocalHost(hostname: string) {
  const host = normalizeHostname(hostname);
  return host.startsWith("169.254.") || /^fe[89ab][0-9a-f]:/i.test(host);
}

function isMulticastHost(hostname: string) {
  const host = normalizeHostname(hostname);
  if (/^ff[0-9a-f]{2}:/i.test(host)) {
    return true;
  }

  const firstOctet = Number(host.split(".")[0]);
  return Number.isInteger(firstOctet) && firstOctet >= 224 && firstOctet <= 239;
}

async function resolveHostnameAddresses(hostname: string) {
  const normalized = normalizeHostname(hostname);
  if (isIP(normalized)) {
    return [];
  }

  try {
    const records = await lookup(normalized, {
      all: true,
      verbatim: true,
    });

    return uniqueStrings(records.map((record) => normalizeIpCandidate(record.address)));
  } catch {
    throw new ApiError(
      400,
      "invalid_jellyfin_server_url",
      "Jellyfin serverUrl hostname could not be resolved for security validation"
    );
  }
}

function assertAllowedResolvedAddress(address: string) {
  if (isUnspecifiedHost(address) || isLinkLocalHost(address) || isMulticastHost(address)) {
    throw new ApiError(
      400,
      "invalid_jellyfin_server_url",
      "Jellyfin serverUrl resolved to an unsafe address"
    );
  }

  if (isLoopbackHost(address) && !ALLOW_LOOPBACK_JELLYFIN_URLS && !JELLYFIN_DEV_BASE_URL) {
    throw new ApiError(
      400,
      "invalid_jellyfin_server_url",
      "For security, localhost Jellyfin URLs are disabled unless CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS is enabled"
    );
  }
}

async function assertAllowedJellyfinServerUrl(url: string) {
  const parsed = assertHttpUrl(url.trim());
  const hostname = normalizeHostname(parsed.hostname);

  if (DISALLOWED_JELLYFIN_HOSTNAMES.has(hostname)) {
    throw new ApiError(
      400,
      "invalid_jellyfin_server_url",
      "Jellyfin serverUrl must point at your Jellyfin server, not a cloud metadata hostname"
    );
  }

  if (isUnspecifiedHost(hostname) || isLinkLocalHost(hostname) || isMulticastHost(hostname)) {
    throw new ApiError(
      400,
      "invalid_jellyfin_server_url",
      "Jellyfin serverUrl must point at your Jellyfin server, not an unspecified, link-local, or multicast host"
    );
  }

  assertAllowedResolvedAddress(hostname);

  for (const address of await resolveHostnameAddresses(hostname)) {
    assertAllowedResolvedAddress(address);
  }

  return parsed;
}

function resolveJellyfinBaseUrl(url: string) {
  const normalized = normalizeBaseUrl(url);
  if (!JELLYFIN_DEV_BASE_URL) {
    return normalized;
  }

  const parsed = assertHttpUrl(normalized);
  if (!isLoopbackHost(parsed.hostname)) {
    return normalized;
  }

  return normalizeBaseUrl(JELLYFIN_DEV_BASE_URL);
}

function sourceHostInfo(baseUrl: string) {
  const parsed = assertHttpUrl(baseUrl);
  const hostname = parsed.hostname.trim();
  if (!hostname) {
    return undefined;
  }

  const port = parsed.port ? numberValue(parsed.port) : undefined;
  const isDefaultHttp = parsed.protocol === "http:" && (port === undefined || port === 80);
  const isDefaultHttps = parsed.protocol === "https:" && (port === undefined || port === 443);
  const label = port === undefined || isDefaultHttp || isDefaultHttps
    ? hostname
    : `${hostname}:${port}`;

  return {
    hostname,
    label,
  };
}

function looksLikeGeneratedServerName(value: string) {
  return /^[a-f0-9]{12,64}$/i.test(value.trim());
}

function jellyfinSourceName(serverName: unknown, baseUrl: string) {
  const normalizedServerName = stringValue(serverName);
  if (normalizedServerName && !looksLikeGeneratedServerName(normalizedServerName)) {
    return normalizedServerName;
  }

  const hostInfo = sourceHostInfo(baseUrl);
  if (!hostInfo || hostInfo.hostname.toLowerCase() === "jellyfin" || isLoopbackHost(hostInfo.hostname)) {
    return "Jellyfin";
  }

  return `Jellyfin (${hostInfo.label})`;
}

function buildJellyfinUrl(baseUrl: string, path: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    return assertHttpUrl(path);
  }

  const base = assertHttpUrl(baseUrl);
  const relative = new URL(path, "http://cliparr.local");
  const basePath = base.pathname === "/" ? "" : base.pathname.replace(/\/+$/, "");
  const next = new URL(base.origin);
  next.pathname = `${basePath}${relative.pathname.startsWith("/") ? relative.pathname : `/${relative.pathname}`}`;
  next.search = relative.search;
  next.hash = "";
  return next;
}

function isLocalConnection(url: URL) {
  const host = url.hostname.toLowerCase();
  return host === "localhost"
    || host === "::1"
    || host === "[::1]"
    || host.startsWith("127.")
    || host.startsWith("10.")
    || host.startsWith("192.168.")
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}

function connectionInfo(baseUrl: string) {
  const parsed = assertHttpUrl(baseUrl);
  return {
    id: parsed.toString(),
    uri: baseUrl,
    local: isLocalConnection(parsed),
    relay: false,
    protocol: parsed.protocol.slice(0, -1),
    address: parsed.hostname,
    port: numberValue(parsed.port) ?? (parsed.protocol === "https:" ? 443 : 80),
  };
}

function jellyfinAuthorization(token?: string, deviceId = JELLYFIN_DEVICE_ID) {
  const fields = [
    ["Client", JELLYFIN_PRODUCT],
    ["Device", JELLYFIN_DEVICE_NAME],
    ["DeviceId", deviceId],
    ["Version", JELLYFIN_VERSION],
    ...(token ? [["Token", token]] as const : []),
  ];

  return `MediaBrowser ${fields
    .map(([key, value]) => `${key}="${encodeURIComponent(value)}"`)
    .join(", ")}`;
}

function jellyfinHeaders(options: {
  headers?: ConstructorParameters<typeof Headers>[0];
  token?: string;
  deviceId?: string;
  accept?: string;
}) {
  const headers = new Headers(options.headers);
  headers.set("Authorization", jellyfinAuthorization(options.token, options.deviceId));

  if (options.accept) {
    headers.set("Accept", options.accept);
  }

  return headers;
}

async function jellyfinFetch(
  url: string,
  init: RequestInit = {},
  options: {
    token?: string;
    deviceId?: string;
    accept?: string;
    timeoutMs?: number;
    errorCode?: string;
    failureMessage?: string;
    exposeFailureDetail?: boolean;
  } = {}
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? JELLYFIN_REQUEST_TIMEOUT_MS);
  const headers = jellyfinHeaders({
    headers: init.headers,
    token: options.token,
    deviceId: options.deviceId,
    accept: options.accept,
  });

  try {
    const response = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });

    if (!response.ok && response.status !== 206) {
      const failureMessage = options.failureMessage ?? "Jellyfin request failed";
      const exposeFailureDetail = options.exposeFailureDetail ?? true;
      const detail = (await response.text().catch(() => ""))
        .slice(0, 400)
        .replace(/\s+/g, " ")
        .trim();

      throw new ApiError(
        !exposeFailureDetail && response.status !== 401 ? 502 : response.status,
        options.errorCode ?? "jellyfin_request_failed",
        !exposeFailureDetail
          ? failureMessage
          : detail
            ? `${failureMessage}: ${detail}`
            : `${failureMessage}: ${response.status} ${response.statusText}`
      );
    }

    return response;
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }

    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError(
        504,
        options.errorCode ?? "jellyfin_request_failed",
        options.failureMessage ?? "Jellyfin request timed out"
      );
    }

    const parsed = new URL(url);
    if (JELLYFIN_DEV_BASE_URL && isLoopbackHost(parsed.hostname)) {
      throw new ApiError(
        502,
        options.errorCode ?? "jellyfin_request_failed",
        `${options.failureMessage ?? "Could not reach that Jellyfin server"}. Cliparr is running in Docker, so localhost points at the Cliparr container. Use ${JELLYFIN_DEV_BASE_URL} for this dev setup.`
      );
    }

    throw new ApiError(
      502,
      options.errorCode ?? "jellyfin_request_failed",
      options.exposeFailureDetail === false
        ? options.failureMessage ?? "Jellyfin request failed"
        : `${options.failureMessage ?? "Jellyfin request failed"}: ${errorMessage(err)}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function jellyfinJson<T>(
  baseUrl: string,
  path: string,
  options: {
    token?: string;
    deviceId?: string;
    timeoutMs?: number;
    method?: string;
    body?: string;
    errorCode?: string;
    failureMessage?: string;
    exposeFailureDetail?: boolean;
  } = {}
) {
  const url = buildJellyfinUrl(baseUrl, path);
  const response = await jellyfinFetch(url.toString(), {
    method: options.method,
    body: options.body,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
  }, {
    ...options,
    accept: "application/json",
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("json")) {
    throw new ApiError(
      502,
      options.errorCode ?? "jellyfin_invalid_response",
      "That URL did not return the Jellyfin API. Make sure it points at your Jellyfin server base URL."
    );
  }

  try {
    return await response.json() as T;
  } catch {
    throw new ApiError(
      502,
      options.errorCode ?? "jellyfin_invalid_response",
      "Jellyfin returned an unreadable response. Make sure the server URL is correct and not a login page."
    );
  }
}

async function parseCredentialsInput(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(
      400,
      "invalid_jellyfin_credentials",
      "Provide a JSON object with Jellyfin serverUrl, username, and password"
    );
  }

  const record = body as Record<string, unknown>;
  const serverUrl = stringValue(record.serverUrl);
  const username = stringValue(record.username);

  if (!serverUrl) {
    throw new ApiError(400, "invalid_jellyfin_server_url", "Jellyfin serverUrl must be a non-empty string");
  }

  if (!username) {
    throw new ApiError(400, "invalid_jellyfin_username", "Jellyfin username must be a non-empty string");
  }

  if (typeof record.password !== "string") {
    throw new ApiError(400, "invalid_jellyfin_password", "Jellyfin password must be a string");
  }

  return {
    serverUrl: resolveJellyfinBaseUrl((await assertAllowedJellyfinServerUrl(serverUrl)).toString()),
    username,
    password: record.password,
  };
}

function sourceContext(source: MediaSource): JellyfinSourceContext {
  const token = stringValue(source.credentials.accessToken);
  const userId = stringValue(source.credentials.userId) ?? stringValue(source.metadata.userId);
  const deviceId = stringValue(source.credentials.deviceId) ?? JELLYFIN_DEVICE_ID;

  if (!token) {
    throw new ApiError(
      500,
      "source_credentials_missing",
      "Stored Jellyfin source is missing its access token"
    );
  }

  if (!userId) {
    throw new ApiError(
      500,
      "source_credentials_missing",
      "Stored Jellyfin source is missing its Jellyfin user id"
    );
  }

  return {
    sourceId: source.id,
    baseUrl: resolveJellyfinBaseUrl(source.baseUrl),
    token,
    userId,
    deviceId,
  };
}

function sourceSupportsCurrentlyPlaying(source: MediaSource) {
  if (!stringValue(source.credentials.accessToken)) {
    return false;
  }

  const isAdministrator = booleanValue(source.metadata.isAdministrator);
  return isAdministrator !== false;
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
  context: JellyfinSourceContext,
  path: string,
  options: { basePath?: string } = {}
) {
  const normalizedPath = mediaPath(path);
  const normalizedBasePath = options.basePath ? mediaPath(options.basePath) : undefined;
  const accessedAt = Date.now();

  for (const existingHandle of session.mediaHandles.values()) {
    if (
      existingHandle.providerId === "jellyfin"
      && existingHandle.sourceId === context.sourceId
      && existingHandle.baseUrl === context.baseUrl
      && existingHandle.path === normalizedPath
      && existingHandle.token === context.token
      && existingHandle.deviceId === context.deviceId
      && existingHandle.basePath === normalizedBasePath
    ) {
      existingHandle.lastAccessedAt = accessedAt;
      return `/api/media/${existingHandle.id}`;
    }
  }

  const handle: MediaHandle = {
    id: randomUUID(),
    providerId: "jellyfin",
    sourceId: context.sourceId,
    baseUrl: context.baseUrl,
    path: normalizedPath,
    token: context.token,
    deviceId: context.deviceId,
    basePath: normalizedBasePath,
    lastAccessedAt: accessedAt,
  };
  session.mediaHandles.set(handle.id, handle);
  return `/api/media/${handle.id}`;
}

function ticksToSeconds(value: unknown) {
  const ticks = Number(value);
  if (!Number.isFinite(ticks) || ticks <= 0) {
    return 0;
  }

  return ticks / 10_000_000;
}

function formatEpisodeCode(seasonNumber?: number, episodeNumber?: number) {
  const season = seasonNumber === undefined ? undefined : `S${String(seasonNumber).padStart(2, "0")}`;
  const episode = episodeNumber === undefined ? undefined : `E${String(episodeNumber).padStart(2, "0")}`;

  if (season && episode) {
    return `${season}${episode}`;
  }

  return season ?? episode;
}

function itemType(item: any) {
  return stringValue(item?.Type) ?? stringValue(item?.MediaType) ?? "Video";
}

function itemTitle(item: any) {
  return stringValue(item?.Name) ?? stringValue(item?.EpisodeTitle) ?? "Untitled";
}

function buildSourceTitle(item: any) {
  const title = itemTitle(item);
  if (itemType(item) !== "Episode") {
    return title;
  }

  const episodeCode = formatEpisodeCode(numberValue(item?.ParentIndexNumber), numberValue(item?.IndexNumber));
  return uniqueStrings([stringValue(item?.SeriesName), episodeCode, title]).join(" - ") || title;
}

function itemImagePath(item: any) {
  const itemId = stringValue(item?.Id);
  const imageTags = item?.ImageTags ?? {};

  if (itemType(item) === "Episode") {
    const parentThumbItemId = stringValue(item?.ParentThumbItemId);
    const parentThumbTag = stringValue(item?.ParentThumbImageTag);
    if (parentThumbItemId && parentThumbTag) {
      return `/Items/${encodeURIComponent(parentThumbItemId)}/Images/Thumb?tag=${encodeURIComponent(parentThumbTag)}`;
    }

    const seriesId = stringValue(item?.SeriesId);
    const seriesTag = stringValue(item?.SeriesPrimaryImageTag);
    if (seriesId && seriesTag) {
      return `/Items/${encodeURIComponent(seriesId)}/Images/Primary?tag=${encodeURIComponent(seriesTag)}`;
    }
  }

  const primaryTag = stringValue(imageTags.Primary);
  if (itemId && primaryTag) {
    return `/Items/${encodeURIComponent(itemId)}/Images/Primary?tag=${encodeURIComponent(primaryTag)}`;
  }

  const thumbTag = stringValue(imageTags.Thumb);
  if (itemId && thumbTag) {
    return `/Items/${encodeURIComponent(itemId)}/Images/Thumb?tag=${encodeURIComponent(thumbTag)}`;
  }

  return undefined;
}

function currentMediaSourceId(sessionInfo: any, item: any) {
  return stringValue(sessionInfo?.PlayState?.MediaSourceId)
    ?? stringValue(asArray(item?.MediaSources)[0]?.Id)
    ?? stringValue(asArray(sessionInfo?.NowPlayingItem?.MediaSources)[0]?.Id);
}

function buildStaticStreamPath(item: any, mediaSourceId: string | undefined, context: JellyfinSourceContext, playSessionId: string) {
  const itemId = stringValue(item?.Id);
  if (!itemId) {
    return undefined;
  }

  const isAudio = String(item?.MediaType ?? "").toLowerCase() === "audio";
  const params = new URLSearchParams({
    static: "true",
    deviceId: context.deviceId,
    playSessionId,
    context: "Static",
  });

  if (mediaSourceId) {
    params.set("mediaSourceId", mediaSourceId);
  }

  return `${isAudio ? `/Audio/${encodeURIComponent(itemId)}/stream` : `/Videos/${encodeURIComponent(itemId)}/stream`}?${params.toString()}`;
}

function buildPreviewPath(item: any, mediaSourceId: string | undefined, context: JellyfinSourceContext, playSessionId: string) {
  const itemId = stringValue(item?.Id);
  if (!itemId || String(item?.MediaType ?? "").toLowerCase() === "audio" || !mediaSourceId) {
    return undefined;
  }

  const params = new URLSearchParams({
    mediaSourceId,
    deviceId: context.deviceId,
    playSessionId,
    maxAudioChannels: "2",
    audioCodec: "aac",
    enableAdaptiveBitrateStreaming: "false",
  });

  return `/Videos/${encodeURIComponent(itemId)}/master.m3u8?${params.toString()}`;
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
    userId: "",
    deviceId: handle.deviceId ?? JELLYFIN_DEVICE_ID,
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

function peopleNames(item: any, kind: string) {
  return uniqueStrings(
    asArray(item?.People).flatMap((person: any) => {
      if (stringValue(person?.Type) !== kind) {
        return [];
      }

      const name = stringValue(person?.Name);
      return name ? [name] : [];
    })
  );
}

function studios(item: any) {
  return uniqueStrings(
    asArray(item?.Studios).map((entry: any) => stringValue(entry?.Name) ?? stringValue(entry?.name))
  );
}

function providerGuids(item: any) {
  const providerIds = item?.ProviderIds;
  if (!providerIds || typeof providerIds !== "object" || Array.isArray(providerIds)) {
    return [];
  }

  return uniqueStrings(
    Object.entries(providerIds as Record<string, unknown>).map(([provider, id]) => {
      const normalizedId = stringValue(id);
      return normalizedId ? `${provider.toLowerCase()}://${normalizedId}` : undefined;
    })
  );
}

function firstTagline(item: any) {
  return uniqueStrings(asArray(item?.Taglines).map((value) => stringValue(value)))[0];
}

function createExportMetadata(
  session: ProviderSessionRecord,
  context: JellyfinSourceContext,
  item: any
): MediaExportMetadata {
  const imagePath = itemImagePath(item);

  return {
    providerId: "jellyfin",
    itemType: itemType(item).toLowerCase(),
    title: itemTitle(item),
    sourceTitle: buildSourceTitle(item),
    showTitle: stringValue(item?.SeriesName),
    seasonTitle: stringValue(item?.SeasonName),
    seasonNumber: numberValue(item?.ParentIndexNumber),
    episodeNumber: numberValue(item?.IndexNumber),
    year: numberValue(item?.ProductionYear),
    date: stringValue(item?.PremiereDate)?.slice(0, 10),
    description: stringValue(item?.Overview),
    tagline: firstTagline(item),
    studio: studios(item)[0],
    network: stringValue(item?.SeriesStudio) ?? stringValue(item?.ChannelName),
    contentRating: stringValue(item?.OfficialRating),
    genres: uniqueStrings(asArray(item?.Genres).map((value) => stringValue(value))),
    directors: peopleNames(item, "Director"),
    writers: uniqueStrings([...peopleNames(item, "Writer"), ...peopleNames(item, "Author")]),
    actors: uniqueStrings([
      ...peopleNames(item, "Actor"),
      ...peopleNames(item, "GuestStar"),
      ...peopleNames(item, "Artist"),
    ]).slice(0, 12),
    guids: providerGuids(item),
    ratingKey: stringValue(item?.Id),
    imageUrl: imagePath ? createMediaHandle(session, context, imagePath) : undefined,
  };
}

async function fetchCurrentUser(context: JellyfinSourceContext) {
  return jellyfinJson<any>(context.baseUrl, "/Users/Me", {
    token: context.token,
    deviceId: context.deviceId,
    timeoutMs: JELLYFIN_REQUEST_TIMEOUT_MS,
    errorCode: "jellyfin_auth_failed",
    failureMessage: "Jellyfin authentication failed",
  });
}

async function fetchSessions(context: JellyfinSourceContext) {
  return jellyfinJson<any[]>(context.baseUrl, "/Sessions?activeWithinSeconds=300", {
    token: context.token,
    deviceId: context.deviceId,
    timeoutMs: CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
    errorCode: "jellyfin_sessions_failed",
    failureMessage: "Jellyfin sessions request failed",
  });
}

async function fetchItem(context: JellyfinSourceContext, itemId: string) {
  return jellyfinJson<any>(context.baseUrl, `/Items/${encodeURIComponent(itemId)}?userId=${encodeURIComponent(context.userId)}`, {
    token: context.token,
    deviceId: context.deviceId,
    timeoutMs: CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
    errorCode: "jellyfin_item_failed",
    failureMessage: "Jellyfin item request failed",
  });
}

async function enrichMetadataItem(context: JellyfinSourceContext, item: any) {
  const itemId = stringValue(item?.Id);
  if (!itemId) {
    return item;
  }

  try {
    const fullItem = await fetchItem(context, itemId);
    return {
      ...item,
      ...fullItem,
    };
  } catch (err) {
    console.warn(`Could not fetch metadata for Jellyfin item ${itemId}:`, errorMessage(err));
    return item;
  }
}

function playbackViewer(sourceId: string, sessionId: string, sessionInfo: any) {
  const externalId = stringValue(sessionInfo?.UserId);
  return {
    id: externalId ? `jellyfin:user:${externalId}` : `jellyfin:synthetic:${sourceId}:${sessionId}`,
    providerId: "jellyfin" as const,
    externalId,
    name: stringValue(sessionInfo?.UserName) ?? "Unknown User",
  };
}

async function normalizeCurrentPlayback(
  session: ProviderSessionRecord,
  source: MediaSource,
  context: JellyfinSourceContext,
  sessionInfo: any
): Promise<CurrentlyPlayingEntry | undefined> {
  const nowPlayingItem = sessionInfo?.NowPlayingItem;
  const itemId = stringValue(nowPlayingItem?.Id);
  if (!itemId) {
    return undefined;
  }

  const enrichedItem = await enrichMetadataItem(context, nowPlayingItem);
  const playSessionId = stringValue(sessionInfo?.Id) ?? randomUUID();
  const mediaSourceId = currentMediaSourceId(sessionInfo, enrichedItem);
  const mediaPath = buildStaticStreamPath(enrichedItem, mediaSourceId, context, playSessionId);
  const previewPath = buildPreviewPath(enrichedItem, mediaSourceId, context, playSessionId);
  const imagePath = itemImagePath(enrichedItem);
  const playerState = sessionInfo?.PlayState?.IsPaused ? "paused" : "playing";

  return {
    viewer: playbackViewer(source.id, playSessionId, sessionInfo),
    item: {
      id: `${source.id}:${playSessionId}`,
      source: {
        id: source.id,
        name: source.name,
        providerId: "jellyfin",
      },
      title: itemTitle(enrichedItem),
      type: itemType(enrichedItem).toLowerCase(),
      duration: ticksToSeconds(enrichedItem?.RunTimeTicks ?? nowPlayingItem?.RunTimeTicks),
      playerTitle: stringValue(sessionInfo?.DeviceName)
        ?? stringValue(sessionInfo?.Client)
        ?? stringValue(sessionInfo?.DeviceType)
        ?? "Unknown Device",
      playerState,
      thumbUrl: imagePath ? createMediaHandle(session, context, imagePath) : undefined,
      mediaUrl: mediaPath ? createMediaHandle(session, context, mediaPath) : undefined,
      previewUrl: previewPath ? createMediaHandle(session, context, previewPath, { basePath: playlistBasePath(previewPath) }) : undefined,
      exportMetadata: createExportMetadata(session, context, enrichedItem),
    },
  } satisfies CurrentlyPlayingEntry;
}

export const jellyfinProvider: ProviderImplementation = {
  definition: {
    id: "jellyfin",
    name: "Jellyfin",
    auth: "credentials",
  },

  async authenticateWithCredentials(body) {
    const { serverUrl, username, password } = await parseCredentialsInput(body);
    const publicInfo = await jellyfinJson<any>(serverUrl, "/System/Info/Public", {
      deviceId: JELLYFIN_DEVICE_ID,
      timeoutMs: JELLYFIN_REQUEST_TIMEOUT_MS,
      errorCode: "jellyfin_server_unreachable",
      failureMessage: "Could not reach that Jellyfin server",
      exposeFailureDetail: false,
    });

    let authResult: any;
    try {
      authResult = await jellyfinJson<any>(serverUrl, "/Users/AuthenticateByName", {
        deviceId: JELLYFIN_DEVICE_ID,
        timeoutMs: JELLYFIN_REQUEST_TIMEOUT_MS,
        method: "POST",
        body: JSON.stringify({
          Username: username,
          Pw: password,
        }),
        errorCode: "jellyfin_auth_failed",
        failureMessage: "Jellyfin sign-in failed",
        exposeFailureDetail: false,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        throw new ApiError(401, "invalid_jellyfin_credentials", "Incorrect Jellyfin username or password");
      }

      throw err;
    }

    const accessToken = stringValue(authResult?.AccessToken);
    const user = authResult?.User;
    const userId = stringValue(user?.Id);
    const isAdministrator = user?.Policy?.IsAdministrator === true;
    const serverId = stringValue(authResult?.ServerId) ?? stringValue(publicInfo?.Id);

    if (!accessToken || !userId || !serverId) {
      throw new ApiError(
        502,
        "jellyfin_auth_failed",
        "Jellyfin did not return the server or user details Cliparr needs"
      );
    }

    if (!isAdministrator) {
      throw new ApiError(
        403,
        "jellyfin_admin_required",
        "Cliparr needs a Jellyfin administrator account so it can view active sessions across the server"
      );
    }

    const normalizedBaseUrl = normalizeBaseUrl(serverUrl);

    return {
      userToken: accessToken,
      resources: [{
        id: serverId,
        name: jellyfinSourceName(publicInfo?.ServerName, normalizedBaseUrl),
        product: stringValue(publicInfo?.ProductName) ?? "Jellyfin",
        platform: stringValue(publicInfo?.Version),
        provides: ["server"],
        owned: true,
        accessToken,
        connections: [connectionInfo(normalizedBaseUrl)],
        credentials: {
          userId,
          deviceId: JELLYFIN_DEVICE_ID,
        },
        metadata: {
          serverId,
          serverName: stringValue(publicInfo?.ServerName),
          version: stringValue(publicInfo?.Version),
          username: stringValue(user?.Name) ?? username,
          userId,
          isAdministrator: true,
        },
      } satisfies ProviderResource],
    };
  },

  supportsCurrentlyPlayingSource(source) {
    return sourceSupportsCurrentlyPlaying(source);
  },

  async checkSource(source) {
    try {
      const context = sourceContext(source);
      const [publicInfo, currentUser] = await Promise.all([
        jellyfinJson<any>(context.baseUrl, "/System/Info/Public", {
          deviceId: context.deviceId,
          timeoutMs: JELLYFIN_REQUEST_TIMEOUT_MS,
          errorCode: "jellyfin_server_unreachable",
          failureMessage: "Could not reach that Jellyfin server",
        }),
        fetchCurrentUser(context),
      ]);

      if (currentUser?.Policy?.IsAdministrator !== true) {
        return {
          ok: false as const,
          message: "Cliparr needs a Jellyfin administrator account to read active sessions",
        };
      }

      await fetchSessions(context);

      return {
        ok: true as const,
        name: jellyfinSourceName(publicInfo?.ServerName, context.baseUrl),
        baseUrl: normalizeBaseUrl(context.baseUrl),
        metadata: {
          ...source.metadata,
          product: stringValue(publicInfo?.ProductName) ?? stringValue(source.metadata.product),
          platform: stringValue(publicInfo?.Version) ?? stringValue(source.metadata.platform),
          serverId: stringValue(publicInfo?.Id) ?? stringValue(source.metadata.serverId),
          serverName: stringValue(publicInfo?.ServerName) ?? stringValue(source.metadata.serverName),
          version: stringValue(publicInfo?.Version) ?? stringValue(source.metadata.version),
          username: stringValue(currentUser?.Name) ?? stringValue(source.metadata.username),
          userId: stringValue(currentUser?.Id) ?? stringValue(source.metadata.userId),
          isAdministrator: true,
        },
      };
    } catch (err) {
      if (err instanceof ApiError) {
        return {
          ok: false as const,
          message: err.message,
        };
      }

      throw err;
    }
  },

  async listCurrentlyPlaying(session, source) {
    const context = sourceContext(source);
    const sessions = await fetchSessions(context);
    const activeSessions = sessions.filter((sessionInfo) => Boolean(stringValue(sessionInfo?.NowPlayingItem?.Id)));
    const entries = await Promise.all(
      activeSessions.map((sessionInfo) => normalizeCurrentPlayback(session, source, context, sessionInfo))
    );

    return entries.filter((entry): entry is CurrentlyPlayingEntry => Boolean(entry));
  },

  async proxyMedia(session, handleId, req, res) {
    const handle = session.mediaHandles.get(handleId);
    if (!handle) {
      throw new ApiError(404, "media_not_found", "Media handle was not found or has expired");
    }

    handle.lastAccessedAt = Date.now();

    const headers = jellyfinHeaders({
      token: handle.token,
      deviceId: handle.deviceId,
      accept: req.header("accept") ?? undefined,
    });
    const range = req.header("range");
    if (range) {
      headers.set("Range", range);
    }

    const upstream = await jellyfinFetch(buildJellyfinUrl(handle.baseUrl, handle.path).toString(), {
      headers,
    }, {
      token: handle.token,
      deviceId: handle.deviceId,
      accept: req.header("accept") ?? undefined,
      timeoutMs: JELLYFIN_REQUEST_TIMEOUT_MS,
      errorCode: "jellyfin_media_failed",
      failureMessage: "Jellyfin media request failed",
    });

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
      providerId: "jellyfin",
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  },
};
