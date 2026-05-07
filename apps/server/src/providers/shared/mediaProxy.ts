import { randomUUID } from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type { ReadableStream as WebReadableStream } from "stream/web";
import type { Response } from "express";
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

interface CachedProxyMediaResponse {
  status: number;
  headers: [string, string][];
  body: Buffer;
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
const logger = getServerLogger(["providers", "media-proxy"]);
const cachedProxyResponses = new Map<string, {
  expiresAt: number;
  response: CachedProxyMediaResponse;
}>();
const inflightProxyResponses = new Map<string, Promise<CachedProxyMediaResponse>>();

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
  logger.debug("Created provider media handle {handleId}.", {
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
  uri: string
) {
  const nextPath = resolvePlaylistUri(basePath, uri);
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
  upstream: globalThis.Response
) {
  const body = await upstream.text();
  const basePath = handle.basePath ?? playlistBasePath(handle.path);
  let rewrittenUriCount = 0;

  const playlist = body
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return line;
      }

      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
          rewrittenUriCount += 1;
          return `URI="${rewritePlaylistUri(session, handle, basePath, uri)}"`;
        });
      }

      rewrittenUriCount += 1;
      return rewritePlaylistUri(session, handle, basePath, trimmed);
    })
    .join("\n");

  logger.debug("Rewrote HLS playlist for media handle {handleId}.", {
    handleId: handle.id,
    sessionId: session.id,
    providerId: handle.providerId,
    path: sanitizeLoggedMediaPath(handle.path),
    basePath: sanitizeLoggedMediaPath(basePath),
    upstreamStatus: upstream.status,
    rewrittenUriCount,
  });

  return playlist;
}

function copyProxyHeaders(upstream: globalThis.Response, res: Response) {
  for (const header of PROXY_HEADER_ALLOWLIST) {
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
) {
  const contentType = upstream.headers.get("content-type") ?? "";
  const headers = snapshotProxyHeaders(upstream);

  if (isHlsPlaylist(handle, contentType)) {
    const playlist = await rewriteHlsPlaylist(session, handle, upstream);
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
  const nextHeaders = upstream.body
    ? headers
    : headers.filter(([name]) => name !== "content-length");

  if (!upstream.body) {
    nextHeaders.push(["content-length", "0"]);
  } else if (!nextHeaders.some(([name]) => name === "content-length")) {
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
  res: Response
) {
  res.status(upstream.status);
  copyProxyHeaders(upstream, res);

  const contentType = upstream.headers.get("content-type") ?? "";
  logger.debug("Proxying upstream media response for handle {handleId}.", {
    handleId: handle.id,
    sessionId: session.id,
    providerId: handle.providerId,
    path: sanitizeLoggedMediaPath(handle.path),
    upstreamStatus: upstream.status,
    contentType,
  });

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
      logger.debug(logMessage, properties);
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
    logger.debug("Served cached proxied media response for handle {handleId}.", {
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
      const response = await createCachedProxyMediaResponse(session, handle, upstream);

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
    logger.debug("Waiting for in-flight proxied media response for handle {handleId}.", {
      handleId: handle.id,
      sessionId: session.id,
      providerId: handle.providerId,
      path: sanitizeLoggedMediaPath(handle.path),
      cacheKey,
    });
  }

  sendCachedProxyResponse(await inflightResponse, res);
}
