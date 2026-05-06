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

const RELATIVE_MEDIA_BASE_URL = "http://cliparr.local";
const logger = getServerLogger(["providers", "media-proxy"]);

function isAbsoluteUrl(path: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(path);
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
        path: normalizedPath,
        basePath: normalizedBasePath,
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
    path: handle.path,
    basePath: handle.basePath,
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
    path: handle.path,
    basePath,
    upstreamStatus: upstream.status,
    rewrittenUriCount,
  });

  return playlist;
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
    path: handle.path,
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
      path: handle.path,
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
