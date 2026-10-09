import type { Request, Response as ExpressResponse } from "express";
import {
  compactLogFields,
  logDurationFields,
  logErrorFields,
  logEventFields,
} from "@cliparr/shared/logging";
import { createApiError, isApiError } from "@/http/errors";
import { getServerLogger, warnWithError } from "@/logging";
import {
  bodyUrl,
  buildLocalUrlMediaHandle,
  getLocalUrlMediaHandle,
  isHlsPlaylistUrl,
  LOCAL_URL_PROVIDER_ID,
  localUrlSession,
  pruneLocalUrlMediaHandles,
  storeLocalUrlMediaHandle,
} from "@/providers/localUrl/mediaHandles";
import {
  assertAllowedMediaHandleRequestUrl,
  fetchMediaHandleRequest,
  mediaHandleRequestUrl,
  mediaProxyAcceptHeader,
  proxyProviderMediaResponse,
  sanitizeLoggedMediaPath,
  shouldForwardMediaRange,
} from "@/providers/shared/mediaProxy";
import { errorMessage } from "@/providers/shared/utilities";
import type { MediaHandle, ProviderImplementation } from "@/providers/types";
import type { ProviderSessionRecord } from "@/session/store";

const localUrlLogger = getServerLogger("media").getChild("local_url");
const LOCAL_URL_ERROR_BODY_MAX_BYTES = 4096;

async function readLocalUrlErrorBody(response: Response) {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const bytes = new Uint8Array(LOCAL_URL_ERROR_BODY_MAX_BYTES);
  let length = 0;
  try {
    while (length < bytes.length) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = value.subarray(0, bytes.length - length);
      bytes.set(chunk, length);
      length += chunk.length;
    }
    return new TextDecoder().decode(bytes.subarray(0, length));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function createLocalUrlMediaHandleUrl(
  _session: ProviderSessionRecord,
  _handle: MediaHandle,
  nextPath: string,
  basePath: string,
) {
  return storeLocalUrlMediaHandle(buildLocalUrlMediaHandle(nextPath, basePath));
}

export async function createLocalUrlMedia(body: unknown): Promise<{
  mediaUrl: string;
  hls: boolean;
}> {
  const startedAt = Date.now();

  try {
    const prunedCount = pruneLocalUrlMediaHandles();
    const handle = buildLocalUrlMediaHandle(bodyUrl(body));
    await assertAllowedMediaHandleRequestUrl(handle);
    const mediaUrl = storeLocalUrlMediaHandle(handle);

    localUrlLogger.trace("Created local URL media handle.", {
      ...logEventFields("media.local_url.handle", "created"),
      "media.handle.id": handle.id,
      "upstream.url": sanitizeLoggedMediaPath(handle.path),
      "media.hls": isHlsPlaylistUrl(handle.path),
    });

    localUrlLogger.info("Local URL media handle created.", {
      ...logEventFields("media.local_url.create", "success"),
      ...logDurationFields(startedAt),
      "media.handle.id": handle.id,
      "upstream.url": sanitizeLoggedMediaPath(handle.path),
      "media.hls": isHlsPlaylistUrl(handle.path),
      "media.handle.pruned_count": prunedCount,
    });

    return { mediaUrl, hls: isHlsPlaylistUrl(handle.path) };
  } catch (error) {
    warnWithError(
      localUrlLogger,
      error,
      "Local URL media handle creation failed.",
      compactLogFields({
        ...logEventFields("media.local_url.create", "failure"),
        ...logDurationFields(startedAt),
        ...logErrorFields(error),
        "http.status_code": isApiError(error) ? error.status : undefined,
      }),
    );
    throw error;
  }
}

export async function proxyLocalUrlMedia(
  handleId: string,
  request: Request,
  res: ExpressResponse,
): Promise<void> {
  const prunedCount = pruneLocalUrlMediaHandles();
  const handle = getLocalUrlMediaHandle(handleId);
  if (!handle) {
    throw createApiError(
      404,
      "local_media_url_not_found",
      "URL media handle was not found or has expired",
    );
  }

  handle.lastAccessedAt = Date.now();

  const requestedRange = request.header("range") ?? undefined;
  const range = shouldForwardMediaRange(handle, requestedRange);
  const accept = mediaProxyAcceptHeader(handle, {
    accept: request.header("accept") ?? undefined,
    range,
  });
  const headers = new Headers(accept ? { Accept: accept } : undefined);
  if (range) {
    headers.set("Range", range);
  }

  const upstreamUrl = mediaHandleRequestUrl(handle).toString();
  localUrlLogger.trace("Fetching local URL media.", {
    "media.handle.id": handle.id,
    "upstream.url": sanitizeLoggedMediaPath(upstreamUrl),
    "media.range.present": Boolean(range),
    accept,
    "media.handle.pruned_count": prunedCount,
  });

  await proxyProviderMediaResponse(
    localUrlSession,
    handle,
    {
      accept,
      range: range ?? undefined,
    },
    async () => {
      try {
        const upstream = await fetchMediaHandleRequest(handle, { headers });
        if (!upstream.ok && upstream.status !== 206) {
          const body = await readLocalUrlErrorBody(upstream);
          const detail = body.slice(0, 400).replaceAll(/\s+/g, " ").trim();
          throw createApiError(
            upstream.status,
            "local_media_url_failed",
            detail
              ? `URL media request failed: ${detail}`
              : "URL media request failed",
          );
        }

        return upstream;
      } catch (error) {
        warnWithError(
          localUrlLogger,
          error,
          "Local URL media request failed.",
          {
            ...logEventFields("media.local_url.fetch", "failure"),
            "media.handle.id": handle.id,
            "upstream.url": sanitizeLoggedMediaPath(upstreamUrl),
            "media.range.present": Boolean(range),
            "http.accept": accept,
            ...logErrorFields(error),
          },
        );

        if (isApiError(error)) {
          throw error;
        }

        throw createApiError(
          502,
          "local_media_url_failed",
          `URL media request failed: ${errorMessage(error)}`,
        );
      }
    },
    res,
    {
      createMediaHandleUrl: createLocalUrlMediaHandleUrl,
    },
  );
}

export const localUrlProvider: ProviderImplementation = {
  definition: {
    id: LOCAL_URL_PROVIDER_ID,
    name: "Local URL",
    auth: "none",
  },
  checkSource: async () => ({ ok: true as const, name: "Local URL" }),
  listCurrentlyPlaying: async () => [],
  watchCurrentlyPlaying: async () => {},
  proxyMedia: (_session, handleId, request, res) =>
    proxyLocalUrlMedia(handleId, request, res),
  serializeSession: (session) => ({
    id: session.id,
    providerId: LOCAL_URL_PROVIDER_ID,
    expiresAt: new Date(session.expiresAt).toISOString(),
  }),
};
