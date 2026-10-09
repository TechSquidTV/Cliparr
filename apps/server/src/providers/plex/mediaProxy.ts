import type { Request, Response } from "express";
import { logEventFields } from "@cliparr/shared/logging";
import { createApiError } from "@/http/errors";
import { getServerLogger } from "@/logging";
import type { ProviderSessionRecord } from "@/session/store";
import {
  fetchMediaHandleRequest,
  mediaProxyAcceptHeader,
  proxyProviderMediaResponse,
  shouldForwardMediaRange,
} from "@/providers/shared/mediaProxy";
import { mediaHandleHlsLogFields } from "@/providers/shared/mediaHandles";
import {
  mediaHandleRequestUrl,
  sanitizeLoggedMediaPath,
  shouldAttachProviderAuth,
} from "@/providers/shared/mediaUrlPolicy";
import { plexMediaHeaders } from "@/providers/plex/shared";
import { preparePlexSubtitleTranscode } from "@/providers/plex/subtitles";

const logger = getServerLogger(["media", "proxy"]);

function transcodeSessionId(path: string) {
  try {
    return new URL(path, "http://cliparr.local").searchParams.get(
      "transcodeSessionId",
    );
  } catch {
    return null;
  }
}

export async function proxyMedia(
  session: ProviderSessionRecord,
  handleId: string,
  request: Request,
  res: Response,
) {
  const handle = session.mediaHandles.get(handleId);
  if (!handle) {
    throw createApiError(
      404,
      "media_not_found",
      "Media handle was not found or has expired",
    );
  }

  handle.lastAccessedAt = Date.now();

  const url = mediaHandleRequestUrl(handle);
  const useProviderAuth = shouldAttachProviderAuth(handle);
  const headers = useProviderAuth
    ? plexMediaHeaders({
        "X-Plex-Token": handle.token,
      })
    : new Headers();

  const requestedRange = request.header("range") ?? undefined;
  const range = shouldForwardMediaRange(handle, requestedRange);
  const accept = mediaProxyAcceptHeader(handle, {
    accept: request.header("accept") ?? undefined,
    range,
  });
  if (accept) {
    headers.set("Accept", accept);
  }
  if (range) {
    headers.set("Range", range);
  }

  const playbackSessionId = useProviderAuth
    ? (handle.providerMetadata?.plex?.playbackSessionId ??
      transcodeSessionId(handle.path))
    : null;
  if (playbackSessionId) {
    headers.set("X-Plex-Session-Identifier", playbackSessionId);
  }
  const subtitleStreamId = useProviderAuth
    ? handle.providerMetadata?.plex?.subtitleStreamId
    : undefined;
  const subtitleRequest = subtitleStreamId
    ? { streamId: subtitleStreamId, controller: new AbortController() }
    : undefined;
  if (subtitleRequest) {
    headers.set("X-Plex-Client-Profile-Name", "Generic");
    headers.set(
      "X-Plex-Client-Profile-Extra",
      "add-transcode-target(type=subtitleProfile&protocol=http&context=all&subtitleCodec=srt&container=srt)",
    );
  }

  logger.trace("Fetching Plex media.", {
    "media.handle.id": handle.id,
    "session.id": session.id,
    "source.id": handle.sourceId,
    "upstream.url": sanitizeLoggedMediaPath(url.toString()),
    "provider.auth.attached": useProviderAuth,
    "media.range.present": Boolean(range),
    "http.accept": accept,
    "plex.playback_session.id": playbackSessionId,
  });

  const abortSubtitleRequest = () => subtitleRequest?.controller.abort();
  if (subtitleRequest) {
    res.once("close", abortSubtitleRequest);
    if (res.destroyed) {
      abortSubtitleRequest();
    }
  }

  try {
    await proxyProviderMediaResponse(
      session,
      handle,
      {
        accept: accept ?? undefined,
        range: range ?? undefined,
      },
      async () => {
        if (subtitleRequest) {
          await preparePlexSubtitleTranscode(
            handle,
            headers,
            subtitleRequest.streamId,
            subtitleRequest.controller.signal,
          );
        }
        const upstream = await fetchMediaHandleRequest(handle, {
          headers,
          signal: subtitleRequest?.controller.signal,
        });
        if (!upstream.ok && upstream.status !== 206) {
          const body = await upstream.text();
          const detail = body.slice(0, 400).replaceAll(/\s+/g, " ").trim();
          logger.warn("Plex media request failed.", {
            ...logEventFields("media.proxy.upstream", "failure"),
            "media.handle.id": handle.id,
            "session.id": session.id,
            "source.id": handle.sourceId,
            "upstream.url": sanitizeLoggedMediaPath(url.toString()),
            "upstream.status_code": upstream.status,
            "upstream.detail": detail,
            "provider.auth.attached": useProviderAuth,
            "media.range.present": Boolean(range),
            "http.accept": accept,
            "plex.playback_session.id": playbackSessionId,
            ...mediaHandleHlsLogFields(handle),
          });
          throw createApiError(
            upstream.status,
            "plex_media_failed",
            detail
              ? `Plex media request failed: ${detail}`
              : "Plex media request failed",
          );
        }

        return upstream;
      },
      res,
    );
  } catch (error) {
    if (!subtitleRequest?.controller.signal.aborted || !res.destroyed) {
      throw error;
    }
  } finally {
    if (subtitleRequest) {
      res.off("close", abortSubtitleRequest);
    }
  }
}
