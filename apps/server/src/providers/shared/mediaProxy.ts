import { randomUUID } from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type { ReadableStream as WebReadableStream } from "stream/web";
import type { Response } from "express";
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

export function normalizeMediaPath(path: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
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
  return `/api/media/${handle.id}`;
}

export function playlistBasePath(path: string) {
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

export async function proxyUpstreamMediaResponse(
  session: ProviderSessionRecord,
  handle: MediaHandle,
  upstream: globalThis.Response,
  res: Response
) {
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

  const body = Readable.fromWeb(upstream.body as unknown as WebReadableStream<Uint8Array>);

  try {
    await pipeline(body, res);
  } catch (err) {
    if (!res.destroyed) {
      res.destroy(err instanceof Error ? err : undefined);
    }
  }
}
