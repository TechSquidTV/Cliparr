import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { Response } from "express";
import { logEventFields } from "@cliparr/shared/logging";
import { createApiError, isApiError } from "@/http/errors";
import { getServerLogger, warnWithError } from "@/logging";
import type { ProviderSessionRecord } from "@/session/store";
import type { MediaHandle } from "@/providers/types";
import {
  isRedirectStatus,
  removeSensitiveRedirectHeaders,
} from "@/providers/shared/networkPolicy";
import { fetchWithPinnedDns } from "@/providers/shared/pinnedFetch";
import {
  HLS_PROXY_RESPONSE_CACHE_MAX_BYTES,
  bufferProxyBody,
  isHlsPlaylist,
  logHlsPlaylistFetch,
  rewriteHlsPlaylist,
  type ProxyMediaResponseOptions,
} from "@/providers/shared/hlsPlaylist";
import {
  assertAllowedMediaHandleRequestUrl,
  isHlsDerivedHandle,
  mediaHandleRequestUrl,
  sanitizeLoggedMediaPath,
} from "@/providers/shared/mediaUrlPolicy";

const logger = getServerLogger(["media", "proxy"]);

interface ProxyMediaRequestOptions {
  accept?: string;
  range?: string;
}

interface FetchMediaHandleRequestInit extends RequestInit {
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  /** Maximum wait for headers or the next response-body chunk. */
  timeoutMs?: number;
}

interface CachedProxyMediaResponse {
  status: number;
  headers: [string, string][];
  body: Buffer;
}

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

const HLS_PROXY_RESPONSE_CACHE_TTL_MS = 4000;

const MEDIA_PROXY_MAX_REDIRECTS = 5;

const MEDIA_PROXY_FETCH_ATTEMPTS = 3;

const HLS_MEDIA_PROXY_FETCH_ATTEMPTS = 8;

const MEDIA_PROXY_FETCH_RETRY_BASE_DELAY_MS = 150;

const MEDIA_PROXY_FETCH_RETRY_MAX_DELAY_MS = 1000;

const RETRYABLE_MEDIA_STATUS_CODES = new Set([
  408, 425, 429, 500, 502, 503, 504,
]);

const cachedProxyResponses = new Map<
  string,
  {
    expiresAt: number;
    response: CachedProxyMediaResponse;
  }
>();

const inflightProxyResponses = new Map<
  string,
  Promise<CachedProxyMediaResponse | null>
>();

function retryDelayMs(attemptIndex: number, baseDelayMs: number) {
  return Math.min(
    MEDIA_PROXY_FETCH_RETRY_MAX_DELAY_MS,
    Math.max(0, baseDelayMs) * 2 ** attemptIndex,
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
      cleanup: () => {},
      resetTimeout: () => {},
    };
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const abortFromSource = () => {
    controller.abort(init.signal ? abortReason(init.signal) : undefined);
  };
  const cleanup = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    init.signal?.removeEventListener("abort", abortFromSource);
    controller.signal.removeEventListener("abort", cleanup);
  };
  const resetTimeout = () => {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (timeoutMs && timeoutMs > 0 && !controller.signal.aborted) {
      timeout = setTimeout(() => {
        controller.abort(
          new DOMException("Media proxy request timed out", "TimeoutError"),
        );
      }, timeoutMs);
    }
  };
  controller.signal.addEventListener("abort", cleanup, { once: true });

  if (init.signal?.aborted) {
    abortFromSource();
  } else {
    init.signal?.addEventListener("abort", abortFromSource, { once: true });
  }

  resetTimeout();

  return {
    init: {
      ...init,
      signal: controller.signal,
    },
    cleanup,
    resetTimeout,
  };
}

function monitorMediaResponseBody(
  response: globalThis.Response,
  attempt: ReturnType<typeof createAttemptRequestInit>,
) {
  if (!response.body || !attempt.init.signal) {
    attempt.cleanup();
    return response;
  }

  const reader = response.body.getReader();
  let finished = false;
  let cancelled = false;
  const finish = () => {
    if (!finished) {
      finished = true;
      attempt.cleanup();
      reader.releaseLock();
    }
  };
  attempt.resetTimeout();
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (cancelled) {
            return;
          }
          if (done) {
            finish();
            controller.close();
          } else {
            attempt.resetTimeout();
            controller.enqueue(value);
          }
        } catch (error) {
          finish();
          controller.error(error);
        }
      },
      async cancel(reason) {
        cancelled = true;
        attempt.cleanup();
        try {
          await reader.cancel(reason);
        } finally {
          finish();
        }
      },
    },
    { highWaterMark: 0 },
  );
  const monitored = new globalThis.Response(body, response);
  // Response construction does not copy fetch metadata. HLS links must still
  // resolve against the final URL after redirects.
  Object.defineProperties(monitored, {
    url: { value: response.url },
    redirected: { value: response.redirected },
    type: { value: response.type },
  });
  return monitored;
}

function isAbortLikeError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function isRetryableMediaFetchError(
  error: unknown,
  sourceSignal: AbortSignal | null | undefined,
) {
  if (sourceSignal?.aborted) {
    return false;
  }

  if (isApiError(error)) {
    return false;
  }

  return error instanceof Error || isAbortLikeError(error);
}

function isRetryableMediaResponse(
  handle: MediaHandle,
  response: globalThis.Response,
) {
  return (
    RETRYABLE_MEDIA_STATUS_CODES.has(response.status) ||
    (response.status === 404 && isHlsDerivedHandle(handle))
  );
}

async function closeRetryableResponse(response: globalThis.Response) {
  try {
    await response.body?.cancel();
  } catch {
    // The response body is discarded before retrying; cleanup failure is non-fatal.
  }
}

async function fetchMediaHandleRequestOnce(
  handle: MediaHandle,
  init: RequestInit = {},
) {
  let requestUrl = mediaHandleRequestUrl(handle);
  let requestInit = init;

  for (
    let redirectCount = 0;
    redirectCount <= MEDIA_PROXY_MAX_REDIRECTS;
    redirectCount += 1
  ) {
    const addresses = await assertAllowedMediaHandleRequestUrl(
      handle,
      requestUrl,
      requestInit.signal ?? undefined,
    );
    const response = await fetchWithPinnedDns(
      requestUrl,
      { ...requestInit, redirect: "manual" },
      addresses,
    );
    const location = response.headers.get("location");
    if (!isRedirectStatus(response.status) || !location) {
      return response;
    }

    const nextUrl = new URL(location, requestUrl);
    if (nextUrl.origin !== requestUrl.origin) {
      requestInit = removeSensitiveRedirectHeaders(requestInit);
    }
    await closeRetryableResponse(response);
    requestUrl = nextUrl;
  }

  throw createApiError(
    502,
    "media_proxy_redirect_limit",
    "Media URL redirected too many times",
  );
}

export async function fetchMediaHandleRequest(
  handle: MediaHandle,
  init: FetchMediaHandleRequestInit = {},
) {
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
    const attempt = createAttemptRequestInit(requestInit, timeoutMs);

    try {
      const response = await fetchMediaHandleRequestOnce(handle, attempt.init);
      if (!isRetryableMediaResponse(handle, response) || isFinalAttempt) {
        return monitorMediaResponseBody(response, attempt);
      }

      await closeRetryableResponse(response);
      attempt.cleanup();
      logger.trace("Retrying media request after retryable upstream status.", {
        "media.handle.id": handle.id,
        "provider.id": handle.providerId,
        "source.id": handle.sourceId,
        "media.path": sanitizeLoggedMediaPath(handle.path),
        "upstream.status_code": response.status,
        "retry.attempt": attemptNumber,
        "retry.max_attempts": totalAttempts,
      });
    } catch (error) {
      attempt.cleanup();
      lastError = error;
      if (
        isFinalAttempt ||
        !isRetryableMediaFetchError(error, requestInit.signal)
      ) {
        throw error;
      }

      logger.trace("Retrying media request after fetch failure.", {
        "media.handle.id": handle.id,
        "provider.id": handle.providerId,
        "source.id": handle.sourceId,
        "media.path": sanitizeLoggedMediaPath(handle.path),
        "retry.attempt": attemptNumber,
        "retry.max_attempts": totalAttempts,
        "error.message": error instanceof Error ? error.message : String(error),
      });
    }

    await delay(retryDelayMs(attemptIndex, retryBaseDelayMs));
  }

  throw lastError;
}

function copyProxyHeaders(upstream: globalThis.Response, res: Response) {
  for (const [header, value] of snapshotProxyHeaders(upstream)) {
    if (header === "content-length") {
      continue;
    }

    res.setHeader(header, value);
  }
}

export function shouldForwardMediaRange(
  handle: MediaHandle,
  range: string | undefined,
) {
  if (!range || isHlsPlaylist(handle, "")) {
    return;
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

  headers.push(
    ["cross-origin-resource-policy", "same-origin"],
    [
      "content-security-policy",
      "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'",
    ],
    ["x-content-type-options", "nosniff"],
  );
  return headers;
}

function applySnapshotHeaders(
  headers: readonly [string, string][],
  res: Response,
) {
  for (const [name, value] of headers) {
    res.setHeader(name, value);
  }
}

function isCacheableMediaRequest(
  handle: MediaHandle,
  range: string | undefined,
) {
  return !range && isHlsDerivedHandle(handle);
}

export function mediaProxyAcceptHeader(
  handle: MediaHandle,
  request: ProxyMediaRequestOptions,
) {
  // A handle-only cache key requires a consistent upstream representation.
  return isCacheableMediaRequest(handle, request.range)
    ? "*/*"
    : request.accept;
}

function pruneCachedProxyResponses(now = Date.now()) {
  for (const [cacheKey, entry] of cachedProxyResponses.entries()) {
    if (entry.expiresAt <= now) {
      cachedProxyResponses.delete(cacheKey);
    }
  }
}

function sendCachedProxyResponse(
  response: CachedProxyMediaResponse,
  res: Response,
) {
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
    logHlsPlaylistFetch(session, handle, upstream, contentType);
    const playlist = await rewriteHlsPlaylist(
      session,
      handle,
      upstream,
      options,
    );
    const body = Buffer.from(playlist);
    const nextHeaders: [string, string][] = [
      ...headers.filter(
        ([name]) => name !== "content-type" && name !== "content-length",
      ),
      ["content-type", "application/vnd.apple.mpegurl"],
      ["content-length", String(body.byteLength)],
    ];

    return {
      status: upstream.status,
      headers: nextHeaders,
      body,
    } satisfies CachedProxyMediaResponse;
  }

  if (
    Number(upstream.headers.get("content-length")) >
    HLS_PROXY_RESPONSE_CACHE_MAX_BYTES
  ) {
    return upstream;
  }
  const body = await bufferProxyBody(upstream);
  if (body instanceof globalThis.Response) {
    return body;
  }
  const nextHeaders = headers.filter(([name]) => name !== "content-length");

  if (upstream.body) {
    nextHeaders.push(["content-length", String(body.byteLength)]);
  } else {
    nextHeaders.push(["content-length", "0"]);
  }

  return {
    status: upstream.status,
    headers: nextHeaders,
    body,
  } satisfies CachedProxyMediaResponse;
}

function describeStreamFailure(error: unknown) {
  if (error instanceof Error) {
    const errorWithCause = error as Error & { code?: string; cause?: unknown };
    const properties: Record<string, unknown> = {
      "error.name": error.name,
      "error.message": error.message,
    };

    if (errorWithCause.code) {
      properties["error.code"] = errorWithCause.code;
    }

    if (errorWithCause.cause instanceof Error) {
      properties["error.cause.name"] = errorWithCause.cause.name;
      properties["error.cause.message"] = errorWithCause.cause.message;
      const causeWithCode = errorWithCause.cause as Error & { code?: string };
      if (causeWithCode.code) {
        properties["error.cause.code"] = causeWithCode.code;
      }
    } else if (errorWithCause.cause !== undefined) {
      properties["error.cause.type"] = typeof errorWithCause.cause;
    }

    return properties;
  }

  return {
    "error.value": String(error),
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
  logger.trace("Proxying upstream media response.", {
    "media.handle.id": handle.id,
    "session.id": session.id,
    "provider.id": handle.providerId,
    "media.path": sanitizeLoggedMediaPath(handle.path),
    "upstream.status_code": upstream.status,
    "upstream.content_type": contentType,
  });

  if (isHlsPlaylist(handle, contentType)) {
    logHlsPlaylistFetch(session, handle, upstream, contentType);
    const playlist = await rewriteHlsPlaylist(
      session,
      handle,
      upstream,
      options,
    );
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
  const upstreamBody = Readable.fromWeb(
    upstream.body as unknown as WebReadableStream<Uint8Array>,
  );
  const closeUpstreamBody = () => {
    upstreamBody.destroy();
  };

  res.once("close", closeUpstreamBody);

  try {
    await pipeline(upstreamBody, res);
  } catch (error) {
    const responseClosed =
      res.destroyed || res.writableEnded || res.writableFinished;
    const logMessage = "Streaming media proxy failed.";
    const properties = {
      ...logEventFields("media.proxy.stream", "failure"),
      "media.handle.id": handle.id,
      "session.id": session.id,
      "provider.id": handle.providerId,
      "media.path": sanitizeLoggedMediaPath(handle.path),
      "http.response.closed": responseClosed,
      ...describeStreamFailure(error),
    };

    if (responseClosed) {
      logger.trace(logMessage, properties);
      return;
    }

    warnWithError(logger, error, logMessage, properties);
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
  const cacheKey = isCacheableMediaRequest(handle, request.range)
    ? handle.id
    : null;
  if (!cacheKey) {
    const upstream = await fetchUpstream();
    await proxyUpstreamMediaResponse(session, handle, upstream, res, options);
    return;
  }

  pruneCachedProxyResponses();

  const cachedResponse = cachedProxyResponses.get(cacheKey);
  if (cachedResponse && cachedResponse.expiresAt > Date.now()) {
    logger.trace("Served cached proxied media response.", {
      ...logEventFields("media.proxy.cache", "hit"),
      "media.handle.id": handle.id,
      "session.id": session.id,
      "provider.id": handle.providerId,
      "media.path": sanitizeLoggedMediaPath(handle.path),
      "media.cache.key": cacheKey,
    });
    sendCachedProxyResponse(cachedResponse.response, res);
    return;
  }

  let streamingUpstream: globalThis.Response | undefined;
  let inflightResponse = inflightProxyResponses.get(cacheKey);
  if (inflightResponse) {
    logger.trace("Waiting for in-flight proxied media response.", {
      ...logEventFields("media.proxy.cache", "wait"),
      "media.handle.id": handle.id,
      "session.id": session.id,
      "provider.id": handle.providerId,
      "media.path": sanitizeLoggedMediaPath(handle.path),
      "media.cache.key": cacheKey,
    });
  } else {
    inflightResponse = (async () => {
      const upstream = await fetchUpstream();
      const response = await createCachedProxyMediaResponse(
        session,
        handle,
        upstream,
        options,
      );

      if (response instanceof globalThis.Response) {
        streamingUpstream = response;
        return null;
      }
      if (response.body.byteLength <= HLS_PROXY_RESPONSE_CACHE_MAX_BYTES) {
        cachedProxyResponses.set(cacheKey, {
          expiresAt: Date.now() + HLS_PROXY_RESPONSE_CACHE_TTL_MS,
          response,
        });
      }

      return response;
    })();

    inflightProxyResponses.set(cacheKey, inflightResponse);
    void inflightResponse
      .finally(() => {
        if (inflightProxyResponses.get(cacheKey) === inflightResponse) {
          inflightProxyResponses.delete(cacheKey);
        }
      })
      .catch(() => {
        // The original in-flight promise is awaited below; this prevents the
        // cleanup promise from becoming a separate unhandled rejection.
      });
  }

  const response = await inflightResponse;
  if (response) {
    sendCachedProxyResponse(response, res);
  } else {
    await proxyUpstreamMediaResponse(
      session,
      handle,
      streamingUpstream ?? (await fetchUpstream()),
      res,
      options,
    );
  }
}
