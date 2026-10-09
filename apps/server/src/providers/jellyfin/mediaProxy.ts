import type { Request, Response } from "express";
import { logErrorFields, logEventFields } from "@cliparr/shared/logging";
import { createApiError } from "@/http/errors";
import { getServerLogger, warnWithError } from "@/logging";
import type { ProviderSessionRecord } from "@/session/store";
import {
  fetchMediaHandleRequest,
  mediaProxyAcceptHeader,
  proxyProviderMediaResponse,
  shouldForwardMediaRange,
} from "@/providers/shared/mediaProxy";
import { createProviderMediaHandle } from "@/providers/shared/mediaHandles";
import {
  mediaHandleRequestUrl,
  sanitizeLoggedMediaPath,
  shouldAttachProviderAuth,
} from "@/providers/shared/mediaUrlPolicy";
import { errorMessage } from "@/providers/shared/utilities";
import {
  jellyfinHeaders,
  JELLYFIN_REQUEST_TIMEOUT_MS,
  type JellyfinSourceContext,
} from "@/providers/jellyfin/shared";

const logger = getServerLogger(["media", "proxy"]);

export function createMediaHandle(
  session: ProviderSessionRecord,
  context: JellyfinSourceContext,
  path: string,
  options: { basePath?: string } = {},
) {
  const basePathPrefix = new URL(context.baseUrl).pathname.replace(/\/$/, "");
  return createProviderMediaHandle(
    session,
    {
      providerId: "jellyfin",
      sourceId: context.sourceId,
      baseUrl: context.baseUrl,
      token: context.token,
      providerMetadata: {
        jellyfin: {
          deviceId: context.deviceId,
        },
      },
    },
    `${basePathPrefix}${path}`,
    {
      ...options,
      basePath: options.basePath
        ? `${basePathPrefix}${options.basePath}`
        : undefined,
    },
  );
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

  const requestedRange = request.header("range") ?? undefined;
  const range = shouldForwardMediaRange(handle, requestedRange);
  const accept = mediaProxyAcceptHeader(handle, {
    accept: request.header("accept") ?? undefined,
    range,
  });
  const useProviderAuth = shouldAttachProviderAuth(handle);
  const headers = useProviderAuth
    ? jellyfinHeaders({
        token: handle.token,
        deviceId: handle.providerMetadata?.jellyfin?.deviceId,
        accept,
      })
    : new Headers(accept ? { Accept: accept } : undefined);
  if (range) {
    headers.set("Range", range);
  }

  const upstreamUrl = mediaHandleRequestUrl(handle).toString();

  logger.trace("Fetching Jellyfin media.", {
    "media.handle.id": handle.id,
    "session.id": session.id,
    "source.id": handle.sourceId,
    "upstream.url": sanitizeLoggedMediaPath(upstreamUrl),
    "provider.auth.attached": useProviderAuth,
    "media.range.present": Boolean(range),
    "http.accept": accept,
  });

  await proxyProviderMediaResponse(
    session,
    handle,
    {
      accept,
      range: range ?? undefined,
    },
    async () => {
      try {
        const upstream = await fetchMediaHandleRequest(handle, {
          headers,
          timeoutMs: JELLYFIN_REQUEST_TIMEOUT_MS,
        });

        if (!upstream.ok && upstream.status !== 206) {
          const body = await upstream.text();
          const detail = body.slice(0, 400).replaceAll(/\s+/g, " ").trim();
          throw createApiError(
            upstream.status,
            "jellyfin_media_failed",
            detail
              ? `Jellyfin media request failed: ${detail}`
              : "Jellyfin media request failed",
          );
        }

        return upstream;
      } catch (error) {
        warnWithError(logger, error, "Jellyfin media request failed.", {
          ...logEventFields("media.proxy.upstream", "failure"),
          ...logErrorFields(error),
          "media.handle.id": handle.id,
          "session.id": session.id,
          "source.id": handle.sourceId,
          "upstream.url": sanitizeLoggedMediaPath(upstreamUrl),
          "provider.auth.attached": useProviderAuth,
          "media.range.present": Boolean(range),
          "http.accept": accept,
          "error.message": errorMessage(error),
        });
        throw error;
      }
    },
    res,
  );
}
