import { randomUUID } from "crypto";
import { lookup } from "dns/promises";
import { isIP } from "net";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type { ReadableStream as WebReadableStream } from "stream/web";
import type { Response } from "express";
import { ApiError } from "../../http/errors.js";
import { getServerLogger } from "../../logging.js";
import type { ProviderSessionRecord } from "../../session/store.js";
import type { MediaHandle } from "../types.js";

interface MediaHandleContext {
  providerId: MediaHandle["providerId"];
  sourceId: string;
  baseUrl: string;
  token: string;
  deviceId?: string;
}

interface CreateMediaHandleOptions {
  basePath?: string;
}

interface ProxyMediaRequestOptions {
  accept?: string;
  range?: string;
}

interface ProxyMediaResponseOptions {
  createMediaHandleUrl?: (
    session: ProviderSessionRecord,
    handle: MediaHandle,
    nextPath: string,
    basePath: string,
  ) => string;
}

interface FetchMediaHandleRequestInit extends RequestInit {
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  timeoutMs?: number;
}

interface CachedProxyMediaResponse {
  status: number;
  headers: [string, string][];
  body: Buffer;
}

interface ResolvedHostnameCacheEntry {
  expiresAt: number;
  addresses: string[];
}

const RELATIVE_MEDIA_BASE_URL = "http://cliparr.local";
const PROXY_HEADER_ALLOWLIST = [
  "accept-ranges",
  "cache-control",
  "content-disposition",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
] as const;
const HLS_PROXY_RESPONSE_CACHE_TTL_MS = 4_000;
const HLS_PROXY_RESPONSE_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const MEDIA_PROXY_MAX_REDIRECTS = 5;
const MEDIA_PROXY_FETCH_ATTEMPTS = 3;
const HLS_MEDIA_PROXY_FETCH_ATTEMPTS = 5;
const MEDIA_PROXY_FETCH_RETRY_BASE_DELAY_MS = 150;
const MEDIA_PROXY_FETCH_RETRY_MAX_DELAY_MS = 1_000;
const DNS_VALIDATION_CACHE_TTL_MS = 60_000;
const DISALLOWED_MEDIA_HOSTNAMES = new Set([
  "metadata",
  "metadata.azure.internal",
  "metadata.google.internal",
]);
const RETRYABLE_MEDIA_STATUS_CODES = new Set([
  408,
  425,
  429,
  500,
  502,
  503,
  504,
]);
const logger = getServerLogger(["providers", "media-proxy"]);
const cachedProxyResponses = new Map<string, {
  expiresAt: number;
  response: CachedProxyMediaResponse;
}>();
const inflightProxyResponses = new Map<string, Promise<CachedProxyMediaResponse>>();
const resolvedHostnameCache = new Map<string, ResolvedHostnameCacheEntry>();
const inflightHostnameResolutions = new Map<string, Promise<string[]>>();

function isAbsoluteUrl(path: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(path);
}

function safeUrl(value: string, base?: string) {
  try {
    return base ? new URL(value, base) : new URL(value);
  } catch {
    return null;
  }
}

export function normalizeMediaPath(path: string) {
  if (isAbsoluteUrl(path)) {
    return path;
  }

  if (!path.startsWith("/")) {
    return `/${path}`;
  }

  return path;
}

export function mediaHandleRequestUrl(handle: Pick<MediaHandle, "baseUrl" | "path">) {
  return new URL(handle.path, handle.baseUrl);
}

export function shouldAttachProviderAuth(handle: Pick<MediaHandle, "baseUrl" | "path">) {
  const requestUrl = mediaHandleRequestUrl(handle);
  const providerUrl = safeUrl(handle.baseUrl);
  return providerUrl ? requestUrl.origin === providerUrl.origin : true;
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

function ipv4Octets(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return undefined;
  }

  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return undefined;
  }

  return octets as [number, number, number, number];
}

function isUnsafeIpv4Host(hostname: string) {
  const octets = ipv4Octets(hostname);
  if (!octets) {
    return false;
  }

  const [first, second] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || first >= 224;
}

function isUnsafeIpv6Host(hostname: string) {
  return hostname === "::"
    || hostname === "::1"
    || hostname === "0:0:0:0:0:0:0:1"
    || /^f[cd][0-9a-f]{2}:/i.test(hostname)
    || /^fe[89ab][0-9a-f]:/i.test(hostname)
    || /^ff[0-9a-f]{2}:/i.test(hostname);
}

function isUnsafeMediaHostname(hostname: string) {
  const normalized = normalizeHostname(hostname);
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || DISALLOWED_MEDIA_HOSTNAMES.has(normalized)
    || isUnsafeIpv4Host(normalized)
    || isUnsafeIpv6Host(normalized);
}

async function resolveHostnameAddresses(hostname: string) {
  const normalized = normalizeHostname(hostname);
  if (isIP(normalized)) {
    return [];
  }

  const now = Date.now();
  const cached = resolvedHostnameCache.get(normalized);
  if (cached && cached.expiresAt > now) {
    return cached.addresses;
  }

  let inflight = inflightHostnameResolutions.get(normalized);
  if (!inflight) {
    inflight = (async () => {
      try {
        const records = await lookup(normalized, {
          all: true,
          verbatim: true,
        });
        const addresses = [...new Set(records.map((record) => normalizeIpCandidate(record.address)))];
        resolvedHostnameCache.set(normalized, {
          addresses,
          expiresAt: Date.now() + DNS_VALIDATION_CACHE_TTL_MS,
        });
        return addresses;
      } catch {
        throw new ApiError(
          502,
          "media_proxy_unsafe_url",
          "Media URL hostname could not be resolved for security validation"
        );
      }
    })();
    inflightHostnameResolutions.set(normalized, inflight);
    const cleanupInflight = () => {
      if (inflightHostnameResolutions.get(normalized) === inflight) {
        inflightHostnameResolutions.delete(normalized);
      }
    };
    void inflight.then(cleanupInflight, cleanupInflight);
  }

  return inflight;
}

function throwUnsafeMediaUrl() {
  throw new ApiError(
    400,
    "media_proxy_unsafe_url",
    "Media URL points at an unsafe internal address"
  );
}

export async function assertAllowedMediaHandleRequestUrl(
  handle: Pick<MediaHandle, "baseUrl" | "path">,
  requestUrl = mediaHandleRequestUrl(handle)
) {
  if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") {
    throw new ApiError(
      400,
      "media_proxy_unsafe_url",
      "Media URL must use HTTP or HTTPS"
    );
  }

  if (requestUrl.username || requestUrl.password) {
    throwUnsafeMediaUrl();
  }

  const providerUrl = safeUrl(handle.baseUrl);
  if (providerUrl && requestUrl.origin === providerUrl.origin) {
    return;
  }

  if (isUnsafeMediaHostname(requestUrl.hostname)) {
    throwUnsafeMediaUrl();
  }

  for (const address of await resolveHostnameAddresses(requestUrl.hostname)) {
    if (isUnsafeMediaHostname(address)) {
      throwUnsafeMediaUrl();
    }
  }
}

function isRedirectStatus(status: number) {
  return status === 301
    || status === 302
    || status === 303
    || status === 307
    || status === 308;
}

function removeSensitiveRedirectHeaders(init: RequestInit) {
  const headers = new Headers(init.headers);
  headers.delete("authorization");
  headers.delete("cookie");
  headers.delete("x-plex-token");
  return {
    ...init,
    headers,
  };
}

function retryDelayMs(attemptIndex: number, baseDelayMs: number) {
  return Math.min(
    MEDIA_PROXY_FETCH_RETRY_MAX_DELAY_MS,
    Math.max(0, baseDelayMs) * (2 ** attemptIndex),
  );
}

function delay(ms: number) {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function abortReason(signal: AbortSignal): unknown {
  const signalWithReason = signal as AbortSignal & { reason?: unknown };
  return signalWithReason.reason;
}

function createAttemptRequestInit(
  init: RequestInit,
  timeoutMs: number | undefined,
) {
  if (!timeoutMs && !init.signal) {
    return {
      init,
      cleanup: () => undefined,
    };
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const abortFromSource = () => {
    controller.abort(init.signal ? abortReason(init.signal) : undefined);
  };

  if (init.signal?.aborted) {
    abortFromSource();
  } else {
    init.signal?.addEventListener("abort", abortFromSource, { once: true });
  }

  if (timeoutMs && timeoutMs > 0) {
    timeout = setTimeout(() => {
      controller.abort(new DOMException("Media proxy request timed out", "TimeoutError"));
    }, timeoutMs);
  }

  return {
    init: {
      ...init,
      signal: controller.signal,
    },
    cleanup: () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      init.signal?.removeEventListener("abort", abortFromSource);
    },
  };
}

function isAbortLikeError(err: unknown) {
  return err instanceof DOMException
    && (err.name === "AbortError" || err.name === "TimeoutError");
}

function isRetryableMediaFetchError(err: unknown, sourceSignal: AbortSignal | null | undefined) {
  if (sourceSignal?.aborted) {
    return false;
  }

  if (err instanceof ApiError) {
    return false;
  }

  return err instanceof Error || isAbortLikeError(err);
}

function isRetryableMediaResponse(handle: MediaHandle, response: globalThis.Response) {
  return RETRYABLE_MEDIA_STATUS_CODES.has(response.status)
    || (response.status === 404 && isHlsDerivedHandle(handle));
}

async function closeRetryableResponse(response: globalThis.Response) {
  try {
    await response.body?.cancel();
  } catch {
    // The response body is discarded before retrying; cleanup failure is non-fatal.
  }
}

async function fetchMediaHandleRequestOnce(handle: MediaHandle, init: RequestInit = {}) {
  let requestUrl = mediaHandleRequestUrl(handle);
  let requestInit = init;

  for (let redirectCount = 0; redirectCount <= MEDIA_PROXY_MAX_REDIRECTS; redirectCount += 1) {
    await assertAllowedMediaHandleRequestUrl(handle, requestUrl);

    const response = await fetch(requestUrl.toString(), {
      ...requestInit,
      redirect: "manual",
    });
    const location = response.headers.get("location");
    if (!isRedirectStatus(response.status) || !location) {
      return response;
    }

    const nextUrl = new URL(location, requestUrl);
    if (nextUrl.origin !== requestUrl.origin) {
      requestInit = removeSensitiveRedirectHeaders(requestInit);
    }
    requestUrl = nextUrl;
  }

  throw new ApiError(
    502,
    "media_proxy_redirect_limit",
    "Media URL redirected too many times"
  );
}

export async function fetchMediaHandleRequest(handle: MediaHandle, init: FetchMediaHandleRequestInit = {}) {
  const {
    retryAttempts = MEDIA_PROXY_FETCH_ATTEMPTS,
    retryBaseDelayMs = MEDIA_PROXY_FETCH_RETRY_BASE_DELAY_MS,
    timeoutMs,
    ...requestInit
  } = init;
  const totalAttempts = Math.max(
    1,
    Math.floor(retryAttempts),
    isHlsDerivedHandle(handle) ? HLS_MEDIA_PROXY_FETCH_ATTEMPTS : 1,
  );
  let lastError: unknown;

  for (let attemptIndex = 0; attemptIndex < totalAttempts; attemptIndex += 1) {
    const attemptNumber = attemptIndex + 1;
    const isFinalAttempt = attemptNumber >= totalAttempts;
    const { init: attemptInit, cleanup } = createAttemptRequestInit(requestInit, timeoutMs);

    try {
      const response = await fetchMediaHandleRequestOnce(handle, attemptInit).finally(cleanup);
      if (!isRetryableMediaResponse(handle, response) || isFinalAttempt) {
        return response;
      }

      await closeRetryableResponse(response);
      logger.trace("Retrying media request after retryable upstream status for handle {handleId}.", {
        handleId: handle.id,
        providerId: handle.providerId,
        sourceId: handle.sourceId,
        path: sanitizeLoggedMediaPath(handle.path),
        statusCode: response.status,
        attempt: attemptNumber,
        maxAttempts: totalAttempts,
      });
    } catch (err) {
      cleanup();
      lastError = err;
      if (isFinalAttempt || !isRetryableMediaFetchError(err, requestInit.signal)) {
        throw err;
      }

      logger.trace("Retrying media request after fetch failure for handle {handleId}.", {
        handleId: handle.id,
        providerId: handle.providerId,
        sourceId: handle.sourceId,
        path: sanitizeLoggedMediaPath(handle.path),
        attempt: attemptNumber,
        maxAttempts: totalAttempts,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }

    await delay(retryDelayMs(attemptIndex, retryBaseDelayMs));
  }

  throw lastError;
}

export function sanitizeLoggedMediaPath(value: string | undefined) {
  if (!value) {
    return value;
  }

  const absoluteUrl = safeUrl(value);
  if (absoluteUrl) {
    return `${absoluteUrl.origin}${absoluteUrl.pathname}`;
  }

  const relativeUrl = safeUrl(normalizeMediaPath(value), RELATIVE_MEDIA_BASE_URL);
  if (relativeUrl) {
    return relativeUrl.pathname;
  }

  return value.split(/[?#]/, 1)[0] ?? value;
}

export function createProviderMediaHandle(
  session: ProviderSessionRecord,
  context: MediaHandleContext,
  path: string,
  options: CreateMediaHandleOptions = {}
) {
  const normalizedPath = normalizeMediaPath(path);
  const normalizedBasePath = options.basePath ? normalizeMediaPath(options.basePath) : undefined;
  const accessedAt = Date.now();

  for (const existingHandle of session.mediaHandles.values()) {
    if (
      existingHandle.providerId === context.providerId
      && existingHandle.sourceId === context.sourceId
      && existingHandle.baseUrl === context.baseUrl
      && existingHandle.path === normalizedPath
      && existingHandle.token === context.token
      && existingHandle.deviceId === context.deviceId
      && existingHandle.basePath === normalizedBasePath
    ) {
      existingHandle.lastAccessedAt = accessedAt;
      logger.trace("Reused provider media handle {handleId}.", {
        handleId: existingHandle.id,
        sessionId: session.id,
        providerId: context.providerId,
        sourceId: context.sourceId,
        path: sanitizeLoggedMediaPath(normalizedPath),
        basePath: sanitizeLoggedMediaPath(normalizedBasePath),
      });
      return `/api/media/${existingHandle.id}`;
    }
  }

  const handle: MediaHandle = {
    id: randomUUID(),
    providerId: context.providerId,
    sourceId: context.sourceId,
    baseUrl: context.baseUrl,
    path: normalizedPath,
    token: context.token,
    deviceId: context.deviceId,
    basePath: normalizedBasePath,
    lastAccessedAt: accessedAt,
  };
  session.mediaHandles.set(handle.id, handle);
  logger.trace("Created provider media handle {handleId}.", {
    handleId: handle.id,
    sessionId: session.id,
    providerId: handle.providerId,
    sourceId: handle.sourceId,
    path: sanitizeLoggedMediaPath(handle.path),
    basePath: sanitizeLoggedMediaPath(handle.basePath),
    absolutePath: isAbsoluteUrl(handle.path),
  });
  return `/api/media/${handle.id}`;
}

export function playlistBasePath(path: string) {
  const withoutQuery = path.split("?")[0];
  const lastSlash = withoutQuery.lastIndexOf("/");
  return lastSlash >= 0 ? withoutQuery.slice(0, lastSlash + 1) : "/";
}

function resolvePlaylistUri(basePath: string, uri: string) {
  const parsed = new URL(
    uri,
    isAbsoluteUrl(basePath)
      ? basePath
      : new URL(normalizeMediaPath(basePath), RELATIVE_MEDIA_BASE_URL),
  );
  parsed.hash = "";

  if (parsed.origin === RELATIVE_MEDIA_BASE_URL) {
    return `${parsed.pathname}${parsed.search}`;
  }

  return parsed.toString();
}

function rewritePlaylistUri(
  session: ProviderSessionRecord,
  handle: MediaHandle,
  basePath: string,
  uri: string,
  options: ProxyMediaResponseOptions = {},
) {
  const nextPath = resolvePlaylistUri(basePath, uri);
  if (options.createMediaHandleUrl) {
    return options.createMediaHandleUrl(session, handle, nextPath, playlistBasePath(nextPath));
  }

  return createProviderMediaHandle(session, {
    providerId: handle.providerId,
    sourceId: handle.sourceId,
    baseUrl: handle.baseUrl,
    token: handle.token,
    deviceId: handle.deviceId,
  }, nextPath, {
    basePath: playlistBasePath(nextPath),
  });
}

async function rewriteHlsPlaylist(
  session: ProviderSessionRecord,
  handle: MediaHandle,
  upstream: globalThis.Response,
  options: ProxyMediaResponseOptions = {},
) {
  const body = await upstream.text();
  const basePath = handle.basePath ?? playlistBasePath(handle.path);
  let rewrittenUriCount = 0;
  let strippedStartHintCount = 0;

  const playlist = body
    .split("\n")
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return [line];
      }

      if (trimmed.startsWith("#")) {
        if (trimmed.toUpperCase().startsWith("#EXT-X-START:")) {
          strippedStartHintCount += 1;
          return [];
        }

        return [line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
          rewrittenUriCount += 1;
          return `URI="${rewritePlaylistUri(session, handle, basePath, uri, options)}"`;
        })];
      }

      rewrittenUriCount += 1;
      return [rewritePlaylistUri(session, handle, basePath, trimmed, options)];
    })
    .join("\n");

  logger.trace("Rewrote HLS playlist for media handle {handleId}.", {
    handleId: handle.id,
    sessionId: session.id,
    providerId: handle.providerId,
    path: sanitizeLoggedMediaPath(handle.path),
    basePath: sanitizeLoggedMediaPath(basePath),
    upstreamStatus: upstream.status,
    rewrittenUriCount,
    strippedStartHintCount,
  });

  return playlist;
}

function copyProxyHeaders(upstream: globalThis.Response, res: Response) {
  for (const header of PROXY_HEADER_ALLOWLIST) {
    if (header === "content-length") {
      continue;
    }

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

export function shouldForwardMediaRange(handle: MediaHandle, range: string | undefined) {
  if (!range || isHlsPlaylist(handle, "")) {
    return undefined;
  }

  return range;
}

function snapshotProxyHeaders(upstream: globalThis.Response) {
  const headers: [string, string][] = [];

  for (const header of PROXY_HEADER_ALLOWLIST) {
    const value = upstream.headers.get(header);
    if (value) {
      headers.push([header, value]);
    }
  }

  headers.push(["cross-origin-resource-policy", "same-origin"]);
  return headers;
}

function applySnapshotHeaders(headers: readonly [string, string][], res: Response) {
  for (const [name, value] of headers) {
    res.setHeader(name, value);
  }
}

function handlePathname(path: string) {
  try {
    return new URL(path, RELATIVE_MEDIA_BASE_URL).pathname.toLowerCase();
  } catch {
    return path.split("?")[0]?.toLowerCase() ?? path.toLowerCase();
  }
}

function isHlsDerivedHandle(handle: MediaHandle) {
  return Boolean(handle.basePath) || handlePathname(handle.path).endsWith(".m3u8");
}

function buildProxyCacheKey(handle: MediaHandle, request: ProxyMediaRequestOptions) {
  if (request.range || !isHlsDerivedHandle(handle)) {
    return null;
  }

  return `${handle.id}:${request.accept ?? ""}`;
}

function pruneCachedProxyResponses(now = Date.now()) {
  for (const [cacheKey, entry] of cachedProxyResponses.entries()) {
    if (entry.expiresAt <= now) {
      cachedProxyResponses.delete(cacheKey);
    }
  }
}

function sendCachedProxyResponse(response: CachedProxyMediaResponse, res: Response) {
  res.status(response.status);
  applySnapshotHeaders(response.headers, res);
  res.end(response.body);
}

async function createCachedProxyMediaResponse(
  session: ProviderSessionRecord,
  handle: MediaHandle,
  upstream: globalThis.Response,
  options: ProxyMediaResponseOptions = {},
) {
  const contentType = upstream.headers.get("content-type") ?? "";
  const headers = snapshotProxyHeaders(upstream);

  if (isHlsPlaylist(handle, contentType)) {
    const playlist = await rewriteHlsPlaylist(session, handle, upstream, options);
    const body = Buffer.from(playlist);
    const nextHeaders = headers
      .filter(([name]) => name !== "content-type" && name !== "content-length")
      .concat([
        ["content-type", "application/vnd.apple.mpegurl"],
        ["content-length", String(body.byteLength)],
      ]);

    return {
      status: upstream.status,
      headers: nextHeaders,
      body,
    } satisfies CachedProxyMediaResponse;
  }

  const body = Buffer.from(await upstream.arrayBuffer());
  const nextHeaders = headers.filter(([name]) => name !== "content-length");

  if (!upstream.body) {
    nextHeaders.push(["content-length", "0"]);
  } else {
    nextHeaders.push(["content-length", String(body.byteLength)]);
  }

  return {
    status: upstream.status,
    headers: nextHeaders,
    body,
  } satisfies CachedProxyMediaResponse;
}

function describeStreamFailure(err: unknown) {
  if (err instanceof Error) {
    const errorWithCause = err as Error & { code?: string; cause?: unknown };
    const properties: Record<string, unknown> = {
      errorName: err.name,
      errorMessage: err.message,
    };

    if (errorWithCause.code) {
      properties.errorCode = errorWithCause.code;
    }

    if (errorWithCause.cause instanceof Error) {
      properties.causeName = errorWithCause.cause.name;
      properties.causeMessage = errorWithCause.cause.message;
      const causeWithCode = errorWithCause.cause as Error & { code?: string };
      if (causeWithCode.code) {
        properties.causeCode = causeWithCode.code;
      }
    } else if (errorWithCause.cause !== undefined) {
      properties.causeType = typeof errorWithCause.cause;
    }

    return properties;
  }

  return {
    errorValue: String(err),
  };
}

export async function proxyUpstreamMediaResponse(
  session: ProviderSessionRecord,
  handle: MediaHandle,
  upstream: globalThis.Response,
  res: Response,
  options: ProxyMediaResponseOptions = {},
) {
  res.status(upstream.status);

  const contentType = upstream.headers.get("content-type") ?? "";
  logger.trace("Proxying upstream media response for handle {handleId}.", {
    handleId: handle.id,
    sessionId: session.id,
    providerId: handle.providerId,
    path: sanitizeLoggedMediaPath(handle.path),
    upstreamStatus: upstream.status,
    contentType,
  });

  if (isHlsPlaylist(handle, contentType)) {
    const playlist = await rewriteHlsPlaylist(session, handle, upstream, options);
    copyProxyHeaders(upstream, res);
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Content-Length", Buffer.byteLength(playlist));
    res.send(playlist);
    return;
  }

  if (!upstream.body) {
    copyProxyHeaders(upstream, res);
    res.setHeader("Content-Length", "0");
    res.end();
    return;
  }

  copyProxyHeaders(upstream, res);
  const upstreamBody = Readable.fromWeb(upstream.body as unknown as WebReadableStream<Uint8Array>);
  const closeUpstreamBody = () => {
    upstreamBody.destroy();
  };

  res.once("close", closeUpstreamBody);

  try {
    await pipeline(upstreamBody, res);
  } catch (err) {
    const responseClosed = res.destroyed || res.writableEnded || res.writableFinished;
    const logMessage = "Streaming media proxy failed for handle {handleId}.";
    const properties = {
      handleId: handle.id,
      sessionId: session.id,
      providerId: handle.providerId,
      path: sanitizeLoggedMediaPath(handle.path),
      responseClosed,
      ...describeStreamFailure(err),
    };

    if (responseClosed) {
      logger.trace(logMessage, properties);
      return;
    }

    logger.warn(logMessage, properties);
    if (!res.destroyed) {
      res.destroy();
    }
  } finally {
    res.off("close", closeUpstreamBody);
  }
}

export async function proxyProviderMediaResponse(
  session: ProviderSessionRecord,
  handle: MediaHandle,
  request: ProxyMediaRequestOptions,
  fetchUpstream: () => Promise<globalThis.Response>,
  res: Response,
  options: ProxyMediaResponseOptions = {},
) {
  const cacheKey = buildProxyCacheKey(handle, request);
  if (!cacheKey) {
    const upstream = await fetchUpstream();
    await proxyUpstreamMediaResponse(session, handle, upstream, res);
    return;
  }

  pruneCachedProxyResponses();

  const cachedResponse = cachedProxyResponses.get(cacheKey);
  if (cachedResponse && cachedResponse.expiresAt > Date.now()) {
    logger.trace("Served cached proxied media response for handle {handleId}.", {
      handleId: handle.id,
      sessionId: session.id,
      providerId: handle.providerId,
      path: sanitizeLoggedMediaPath(handle.path),
      cacheKey,
    });
    sendCachedProxyResponse(cachedResponse.response, res);
    return;
  }

  let inflightResponse = inflightProxyResponses.get(cacheKey);
  if (!inflightResponse) {
    inflightResponse = (async () => {
      const upstream = await fetchUpstream();
      const response = await createCachedProxyMediaResponse(session, handle, upstream, options);

      if (response.body.byteLength <= HLS_PROXY_RESPONSE_CACHE_MAX_BYTES) {
        cachedProxyResponses.set(cacheKey, {
          expiresAt: Date.now() + HLS_PROXY_RESPONSE_CACHE_TTL_MS,
          response,
        });
      }

      return response;
    })();

    inflightProxyResponses.set(cacheKey, inflightResponse);
    void inflightResponse.finally(() => {
      if (inflightProxyResponses.get(cacheKey) === inflightResponse) {
        inflightProxyResponses.delete(cacheKey);
      }
    });
  } else {
    logger.trace("Waiting for in-flight proxied media response for handle {handleId}.", {
      handleId: handle.id,
      sessionId: session.id,
      providerId: handle.providerId,
      path: sanitizeLoggedMediaPath(handle.path),
      cacheKey,
    });
  }

  sendCachedProxyResponse(await inflightResponse, res);
}
