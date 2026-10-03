import { PLEX_CLIENT_IDENTIFIER, PLEX_PRODUCT } from "@/providers/plex/shared";
import { createApiError, isApiError, type ApiError } from "@/http/errors";
import {
  isRedirectStatus,
  isUnsafeRemoteHostname,
  normalizeHostname,
  normalizeIpCandidate,
  removeSensitiveRedirectHeaders,
} from "@/providers/shared/networkPolicy";
import { fetchWithPinnedDns } from "@/providers/shared/pinnedFetch";
import {
  booleanEnv,
  errorMessage,
  uniqueStrings,
} from "@/providers/shared/utilities";
import {
  getIdentity,
  eventsourceGetSlash,
  libraryMetadataGetSlash,
  statusGetSlash,
} from "@cliparr/plex/pms";
import type { Client } from "@cliparr/plex/pms/client";
import { createClient } from "@cliparr/plex/pms/client";
import { lookup } from "node:dns/promises";
import { addAbortListener } from "node:events";
import { isIP } from "node:net";

export interface PlexPmsRequestContext {
  baseUrl: string;
  token: string;
}

export interface PlexPmsRequestOptions {
  clientIdentifier: string;
  product: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

type PlexPmsSdkResult<T> =
  | {
      data: T;
      error: undefined;
      request?: Request;
      response?: Response;
    }
  | {
      data: undefined;
      error: unknown;
      request?: Request;
      response?: Response;
    };

interface PlexPmsResponseApiError extends ApiError {
  plexPmsStatusText: string;
}

const PLEX_PMS_MAX_REDIRECTS = 5;
function assertHttpUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw createApiError(
      400,
      "plex_unsafe_redirect",
      "Plex PMS request URL must use HTTP or HTTPS",
    );
  }

  if (url.username || url.password) {
    throw createApiError(
      400,
      "plex_unsafe_redirect",
      "Plex PMS request URL must not include embedded credentials",
    );
  }
}

function assertAllowedRedirectHostname(
  hostname: string,
  allowPrivate: boolean,
) {
  const loopbackOptIn = booleanEnv(
    process.env.CLIPARR_ALLOW_LOOPBACK_PLEX_URLS,
  );
  // The opt-in applies only to the initial origin, including redirects
  // returning to that origin. Other origins cannot resolve to loopback.
  const allowLoopback = allowPrivate && loopbackOptIn;
  if (!isUnsafeRemoteHostname(hostname, { allowPrivate, allowLoopback })) {
    return;
  }
  if (
    allowPrivate &&
    !loopbackOptIn &&
    !isUnsafeRemoteHostname(hostname, { allowPrivate, allowLoopback: true })
  ) {
    throw createApiError(
      400,
      "plex_unsafe_redirect",
      "For security, localhost Plex URLs are disabled unless CLIPARR_ALLOW_LOOPBACK_PLEX_URLS is enabled",
    );
  }
  throw createApiError(
    400,
    "plex_unsafe_redirect",
    "Plex PMS redirect points at an unsafe internal address",
  );
}

async function resolveHostnameAddresses(hostname: string, signal: AbortSignal) {
  const normalized = normalizeHostname(hostname);
  if (isIP(normalized)) {
    return [];
  }

  signal.throwIfAborted();
  let subscription: ReturnType<typeof addAbortListener> | undefined;
  try {
    const cancellation = new Promise<never>((_resolve, reject) => {
      subscription = addAbortListener(signal, () =>
        reject(sdkRequestError(signal.reason)),
      );
    });
    // lookup() cannot cancel its OS work; stop waiting when the request aborts.
    const records = await Promise.race([
      lookup(normalized, { all: true, verbatim: true }),
      cancellation,
    ]);

    return uniqueStrings(
      records.map((record) => normalizeIpCandidate(record.address)),
    );
  } catch {
    signal.throwIfAborted();
    throw createApiError(
      400,
      "plex_unsafe_redirect",
      "Plex PMS redirect hostname could not be resolved for security validation",
    );
  } finally {
    subscription?.[Symbol.dispose]();
  }
}

async function assertAllowedPlexPmsRequestUrl(
  requestUrl: URL,
  trustedOrigin: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  assertHttpUrl(requestUrl);
  const allowPrivate = requestUrl.origin === trustedOrigin;
  assertAllowedRedirectHostname(requestUrl.hostname, allowPrivate);

  const addresses = await resolveHostnameAddresses(requestUrl.hostname, signal);
  for (const address of addresses) {
    assertAllowedRedirectHostname(address, allowPrivate);
  }
  return addresses;
}

async function reusableRequestBody(request: Request) {
  if (request.method === "GET" || request.method === "HEAD" || !request.body) {
    return;
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("json") || contentType.startsWith("text/")) {
    return request.clone().text();
  }

  return request.clone().arrayBuffer();
}

async function discardPlexResponse(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // A generated error response may already be consumed or locked.
  }
}

function redirectUrl(location: string, requestUrl: URL) {
  try {
    return new URL(location, requestUrl);
  } catch {
    throw createApiError(
      502,
      "plex_invalid_redirect",
      "Plex PMS returned an invalid redirect URL",
    );
  }
}

function updateRedirectRequest(
  init: RequestInit,
  response: Response,
  nextUrl: URL,
  currentUrl: URL,
) {
  const headers = new Headers(
    nextUrl.origin === currentUrl.origin
      ? init.headers
      : removeSensitiveRedirectHeaders(init).headers,
  );
  const method = String(init.method ?? "GET").toUpperCase();
  const shouldSwitchToGet =
    response.status === 303 ||
    ((response.status === 301 || response.status === 302) && method === "POST");

  if (!shouldSwitchToGet) {
    return {
      ...init,
      headers,
    };
  }

  headers.delete("content-length");
  headers.delete("content-type");

  return {
    ...init,
    method: "GET",
    headers,
    body: undefined,
  };
}

async function fetchPlexPmsWithManualRedirects(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) {
  const request = new Request(input, init);
  const signal = init?.signal ?? request.signal;
  signal.throwIfAborted();
  const trustedOrigin = new URL(request.url).origin;
  let requestUrl = new URL(request.url);
  let requestInit: RequestInit = {
    method: request.method,
    headers: new Headers(request.headers),
    body: await reusableRequestBody(request),
    // Retain the caller signal: Request owns its forwarding AbortController.
    signal,
  };

  for (
    let redirectCount = 0;
    redirectCount <= PLEX_PMS_MAX_REDIRECTS;
    redirectCount += 1
  ) {
    const addresses = await assertAllowedPlexPmsRequestUrl(
      requestUrl,
      trustedOrigin,
      signal,
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

    const nextUrl = redirectUrl(location, requestUrl);
    requestInit = updateRedirectRequest(
      requestInit,
      response,
      nextUrl,
      requestUrl,
    );
    await discardPlexResponse(response);
    requestUrl = nextUrl;
  }

  throw createApiError(
    502,
    "plex_redirect_limit",
    "Plex PMS request redirected too many times",
  );
}

export function createPlexPmsSdkClient(
  context: PlexPmsRequestContext,
  options: PlexPmsRequestOptions,
  signal: AbortSignal,
): Client {
  return createClient({
    baseUrl: context.baseUrl,
    headers: {
      Accept: "application/json",
      "X-Plex-Client-Identifier": options.clientIdentifier,
      "X-Plex-Product": options.product,
      "X-Plex-Token": context.token,
    },
    // Keep the original signal alive beyond headers; Request signals forward through GC-sensitive controllers.
    fetch: (input, init) =>
      fetchPlexPmsWithManualRedirects(input, { ...init, signal }),
    parseAs: "json",
    signal,
  });
}

function responseStatusText(response: Response) {
  return response.statusText || "Unknown Status";
}

function sdkRequestError(error: unknown) {
  return error instanceof Error ? error : new Error(errorMessage(error));
}

function createPlexPmsResponseApiError(response: Response) {
  const statusText = responseStatusText(response);
  return Object.assign(
    createApiError(
      response.status,
      "plex_request_failed",
      `Plex request failed: ${response.status} ${statusText}`,
    ),
    {
      plexPmsStatusText: statusText,
    } satisfies Pick<PlexPmsResponseApiError, "plexPmsStatusText">,
  );
}

export function plexPmsResponseStatusMessage(error: unknown) {
  if (
    !isApiError(error) ||
    error.code !== "plex_request_failed" ||
    typeof (error as Partial<PlexPmsResponseApiError>).plexPmsStatusText !==
      "string"
  ) {
    return;
  }

  return `${error.status} ${
    (error as PlexPmsResponseApiError).plexPmsStatusText
  }`;
}

function readPlexPmsResult<T>(result: PlexPmsSdkResult<T>) {
  if (result.data !== undefined) {
    return result.data;
  }

  if (result.response) {
    throw createPlexPmsResponseApiError(result.response);
  }

  throw sdkRequestError(result.error);
}

async function withPlexPmsClient<T>(
  context: PlexPmsRequestContext,
  options: PlexPmsRequestOptions,
  request: (client: Client) => Promise<PlexPmsSdkResult<T>>,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;

  try {
    return readPlexPmsResult(
      await request(createPlexPmsSdkClient(context, options, signal)),
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function openPlexEventStream(
  context: PlexPmsRequestContext,
  headers: Headers,
  signal: AbortSignal,
) {
  const result = await eventsourceGetSlash({
    client: createPlexPmsSdkClient(
      context,
      {
        clientIdentifier: PLEX_CLIENT_IDENTIFIER,
        product: PLEX_PRODUCT,
        timeoutMs: 0,
      },
      signal,
    ),
    headers: { ...Object.fromEntries(headers), Accept: "text/event-stream" },
    parseAs: "stream",
  });
  const response = result.response;
  if (!response) {
    throw sdkRequestError(result.error);
  }
  if (!response.ok) {
    await discardPlexResponse(response);
    throw createPlexPmsResponseApiError(response);
  }
  if (
    !response.body ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  ) {
    await discardPlexResponse(response);
    throw new Error("Plex did not return an event stream");
  }
  return response.body;
}

export function requestPlexPmsIdentity(
  context: PlexPmsRequestContext,
  options: PlexPmsRequestOptions,
) {
  return withPlexPmsClient(context, options, (client) =>
    getIdentity({ client }),
  );
}

export function requestPlexPmsCurrentSessions(
  context: PlexPmsRequestContext,
  options: PlexPmsRequestOptions,
) {
  return withPlexPmsClient(context, options, (client) =>
    statusGetSlash({ client }),
  );
}

export function requestPlexPmsMetadata(
  context: PlexPmsRequestContext,
  ids: string[],
  options: PlexPmsRequestOptions,
) {
  return withPlexPmsClient(context, options, (client) =>
    libraryMetadataGetSlash({
      client,
      path: {
        ids,
      },
    }),
  );
}
