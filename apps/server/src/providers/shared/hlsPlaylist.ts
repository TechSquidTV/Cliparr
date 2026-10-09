import { logEventFields } from "@cliparr/shared/logging";
import { createApiError } from "@/http/errors";
import { getServerLogger } from "@/logging";
import type { MediaHandle } from "@/providers/types";
import type { ProviderSessionRecord } from "@/session/store";
import {
  createProviderMediaHandle,
  mediaHandleLogFields,
} from "@/providers/shared/mediaHandles";
import {
  RELATIVE_MEDIA_BASE_URL,
  hlsUriKind,
  isAbsoluteUrl,
  normalizeMediaPath,
  sanitizeLoggedMediaPath,
} from "@/providers/shared/mediaUrlPolicy";

const logger = getServerLogger(["media", "proxy"]);

export const HLS_PROXY_RESPONSE_CACHE_MAX_BYTES = 8 * 1024 * 1024;

export interface ProxyMediaResponseOptions {
  createMediaHandleUrl?: (
    session: ProviderSessionRecord,
    handle: MediaHandle,
    nextPath: string,
    basePath: string,
  ) => string;
}
export function playlistBasePath(path: string) {
  const withoutQuery = path.split("?")[0];
  const lastSlash = withoutQuery.lastIndexOf("/");
  return lastSlash === -1 ? "/" : withoutQuery.slice(0, lastSlash + 1);
}

function resolvePlaylistUri(playlistUrl: string, uri: string) {
  const parsed = new URL(
    uri,
    isAbsoluteUrl(playlistUrl)
      ? playlistUrl
      : new URL(normalizeMediaPath(playlistUrl), RELATIVE_MEDIA_BASE_URL),
  );
  parsed.hash = "";

  if (parsed.origin === RELATIVE_MEDIA_BASE_URL) {
    return `${parsed.pathname}${parsed.search}`;
  }

  return parsed.toString();
}
function createPlaylistMediaHandleUrl(
  session: ProviderSessionRecord,
  handle: MediaHandle,
  nextPath: string,
  options: ProxyMediaResponseOptions = {},
) {
  if (options.createMediaHandleUrl) {
    return options.createMediaHandleUrl(
      session,
      handle,
      nextPath,
      playlistBasePath(nextPath),
    );
  }

  return createProviderMediaHandle(
    session,
    {
      providerId: handle.providerId,
      sourceId: handle.sourceId,
      baseUrl: handle.baseUrl,
      token: handle.token,
      providerMetadata: handle.providerMetadata,
    },
    nextPath,
    {
      basePath: playlistBasePath(nextPath),
    },
  );
}

function rewritePlaylistUri(
  session: ProviderSessionRecord,
  handle: MediaHandle,
  playlistUrl: string,
  uri: string,
  options: ProxyMediaResponseOptions = {},
) {
  return createPlaylistMediaHandleUrl(
    session,
    handle,
    resolvePlaylistUri(playlistUrl, uri),
    options,
  );
}

export async function rewriteHlsPlaylist(
  session: ProviderSessionRecord,
  handle: MediaHandle,
  upstream: globalThis.Response,
  options: ProxyMediaResponseOptions = {},
) {
  const buffered = await bufferProxyBody(upstream);
  if (buffered instanceof globalThis.Response) {
    await buffered.body?.cancel();
    throw createApiError(
      502,
      "media_proxy_playlist_too_large",
      "HLS playlist exceeds the proxy size limit",
    );
  }
  const body = buffered.toString("utf8");
  const playlistUrl = upstream.url || handle.path;
  let rewrittenUriCount = 0;
  let strippedStartHintCount = 0;
  let firstMediaUriPath: string | undefined;
  let firstMediaUriKind: string | undefined;

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

        return [
          line.replaceAll(/URI="([^"]+)"/g, (_match, uri: string) => {
            rewrittenUriCount += 1;
            return `URI="${rewritePlaylistUri(session, handle, playlistUrl, uri, options)}"`;
          }),
        ];
      }

      rewrittenUriCount += 1;
      const nextPath = resolvePlaylistUri(playlistUrl, trimmed);
      if (!firstMediaUriPath) {
        firstMediaUriPath = nextPath;
        firstMediaUriKind = hlsUriKind(nextPath);
      }
      return [createPlaylistMediaHandleUrl(session, handle, nextPath, options)];
    })
    .join("\n");

  logger.trace("Rewrote HLS playlist for media handle.", {
    ...logEventFields("media.hls.playlist_rewrite", "success"),
    ...mediaHandleLogFields(session, handle, playlistBasePath(playlistUrl)),
    "upstream.status_code": upstream.status,
    "media.hls.first_media.path": sanitizeLoggedMediaPath(firstMediaUriPath),
    "media.hls.first_media.kind": firstMediaUriKind,
    "media.hls.rewritten_uri_count": rewrittenUriCount,
    "media.hls.stripped_start_hint_count": strippedStartHintCount,
  });

  return playlist;
}

export function logHlsPlaylistFetch(
  session: ProviderSessionRecord,
  handle: MediaHandle,
  upstream: globalThis.Response,
  contentType: string,
) {
  logger.trace("Fetched HLS playlist for media handle.", {
    ...logEventFields("media.hls.playlist_fetch", "success"),
    ...mediaHandleLogFields(session, handle),
    "upstream.status_code": upstream.status,
    "upstream.content_type": contentType,
  });
}

export function isHlsPlaylist(handle: MediaHandle, contentType: string) {
  const normalizedContentType = contentType.toLowerCase();
  if (normalizedContentType.includes("mpegurl")) {
    return true;
  }

  try {
    return new URL(handle.path, "http://cliparr.local").pathname.endsWith(
      ".m3u8",
    );
  } catch {
    return handle.path.split("?")[0].endsWith(".m3u8");
  }
}
/** Buffer small responses only; replay the prefix and stream the rest on overflow. */
export async function bufferProxyBody(upstream: globalThis.Response) {
  if (!upstream.body) {
    return Buffer.alloc(0);
  }
  const reader = upstream.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        reader.releaseLock();
        return Buffer.concat(chunks, byteLength);
      }
      chunks.push(value);
      byteLength += value.byteLength;
      if (byteLength > HLS_PROXY_RESPONSE_CACHE_MAX_BYTES) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(chunk);
            }
            chunks.length = 0;
          },
          async pull(controller) {
            try {
              const next = await reader.read();
              if (next.done) {
                reader.releaseLock();
                controller.close();
              } else {
                controller.enqueue(next.value);
              }
            } catch (error) {
              reader.releaseLock();
              controller.error(error);
            }
          },
          async cancel(reason) {
            try {
              await reader.cancel(reason);
            } finally {
              reader.releaseLock();
            }
          },
        });
        return new globalThis.Response(body, upstream);
      }
    }
  } catch (error) {
    reader.releaseLock();
    throw error;
  }
}
