import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createApiError, isApiError, type ApiError } from "@/http/errors";
import { createClient } from "@/providers/plex/generated/client/client.gen";
import type { Client } from "@/providers/plex/generated/client/types.gen";
import {
  getIdentity,
  libraryMetadataGetSlash,
  statusGetSlash,
} from "@/providers/plex/generated/sdk.gen";
import { errorMessage, uniqueStrings } from "@/providers/shared/utilities";

export interface PlexPmsRequestContext {
  baseUrl: string;
  token: string;
}

export interface PlexPmsRequestOptions {
  clientIdentifier: string;
  product: string;
  timeoutMs: number;
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
const DISALLOWED_PLEX_PMS_REDIRECT_HOSTNAMES = new Set([
  "metadata",
  "metadata.azure.internal",
  "metadata.google.internal",
]);

function normalizeIpCandidate(value: string) {
  const normalized = value.toLowerCase();
  const unwrapped =
    normalized.startsWith("[") && normalized.endsWith("]")
      ? normalized.slice(1, -1)
      : normalized;

  const mappedIpv4Prefix = "::ffff:";
  if (!unwrapped.startsWith(mappedIpv4Prefix)) {
    return unwrapped;
  }

  return (
    mappedIpv4Address(unwrapped.slice(mappedIpv4Prefix.length)) ?? unwrapped
  );
}

function normalizeHostname(value: string) {
  return normalizeIpCandidate(value.trim()).replace(/\.+$/, "");
}

function ipv4Octets(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return;
  }

  const octets = parts.map(Number);
  if (
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return;
  }

  return octets as [number, number, number, number];
}

function mappedIpv4Address(hostname: string) {
  const octets = ipv4Octets(hostname);
  if (octets) {
    return octets.join(".");
  }

  const words = hostname.split(":");
  if (words.length !== 2) {
    return;
  }

  const ipv6WordMax = 65_535;
  const byteMask = 255;
  const parsedWords = words.map((word) => Number.parseInt(word, 16));
  if (
    words.some(
      (word, index) =>
        !/^[\da-f]{1,4}$/i.test(word) ||
        !Number.isInteger(parsedWords[index]) ||
        parsedWords[index] < 0 ||
        parsedWords[index] > ipv6WordMax,
    )
  ) {
    return;
  }

  const [high, low] = parsedWords as [number, number];
  return [high >> 8, high & byteMask, low >> 8, low & byteMask].join(".");
}

function isLoopbackHost(hostname: string) {
  const host = normalizeHostname(hostname);
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

function isUnspecifiedHost(hostname: string) {
  const host = normalizeHostname(hostname);
  return host === "0.0.0.0" || host === "::";
}

function isLinkLocalHost(hostname: string) {
  const host = normalizeHostname(hostname);
  return host.startsWith("169.254.") || /^fe[89ab][\da-f]:/i.test(host);
}

function isPrivateHost(hostname: string) {
  const host = normalizeHostname(hostname);
  const octets = ipv4Octets(host);
  if (octets) {
    const [first, second] = octets;
    return (
      first === 10 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  return /^f[cd][\da-f]{2}:/i.test(host);
}

function isMulticastHost(hostname: string) {
  const host = normalizeHostname(hostname);
  if (/^ff[\da-f]{2}:/i.test(host)) {
    return true;
  }

  const firstOctet = Number(host.split(".")[0]);
  return Number.isInteger(firstOctet) && firstOctet >= 224 && firstOctet <= 239;
}

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

function assertAllowedRedirectHostname(hostname: string) {
  const normalized = normalizeHostname(hostname);
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    DISALLOWED_PLEX_PMS_REDIRECT_HOSTNAMES.has(normalized) ||
    isLoopbackHost(normalized) ||
    isUnspecifiedHost(normalized) ||
    isLinkLocalHost(normalized) ||
    isPrivateHost(normalized) ||
    isMulticastHost(normalized)
  ) {
    throw createApiError(
      400,
      "plex_unsafe_redirect",
      "Plex PMS redirect points at an unsafe internal address",
    );
  }
}

async function resolveHostnameAddresses(hostname: string) {
  const normalized = normalizeHostname(hostname);
  if (isIP(normalized)) {
    return [];
  }

  try {
    const records = await lookup(normalized, {
      all: true,
      verbatim: true,
    });

    return uniqueStrings(
      records.map((record) => normalizeIpCandidate(record.address)),
    );
  } catch {
    throw createApiError(
      400,
      "plex_unsafe_redirect",
      "Plex PMS redirect hostname could not be resolved for security validation",
    );
  }
}

async function assertAllowedPlexPmsRequestUrl(
  requestUrl: URL,
  trustedOrigin: string,
) {
  assertHttpUrl(requestUrl);
  if (requestUrl.origin === trustedOrigin) {
    return;
  }

  assertAllowedRedirectHostname(requestUrl.hostname);

  for (const address of await resolveHostnameAddresses(requestUrl.hostname)) {
    assertAllowedRedirectHostname(address);
  }
}

function isRedirectStatus(status: number) {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
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

async function closeRedirectResponse(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // Redirect response bodies are discarded before the next request.
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
  const headers = new Headers(init.headers);
  const method = String(init.method ?? "GET").toUpperCase();
  const shouldSwitchToGet =
    response.status === 303 ||
    ((response.status === 301 || response.status === 302) && method === "POST");

  if (nextUrl.origin !== currentUrl.origin) {
    headers.delete("authorization");
    headers.delete("cookie");
    headers.delete("x-plex-token");
  }

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
  const trustedOrigin = new URL(request.url).origin;
  let requestUrl = new URL(request.url);
  let requestInit: RequestInit = {
    method: request.method,
    headers: new Headers(request.headers),
    body: await reusableRequestBody(request),
    signal: request.signal,
  };

  for (
    let redirectCount = 0;
    redirectCount <= PLEX_PMS_MAX_REDIRECTS;
    redirectCount += 1
  ) {
    await assertAllowedPlexPmsRequestUrl(requestUrl, trustedOrigin);

    const response = await globalThis.fetch(requestUrl.toString(), {
      ...requestInit,
      redirect: "manual",
    });
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
    await closeRedirectResponse(response);
    requestUrl = nextUrl;
  }

  throw createApiError(
    502,
    "plex_redirect_limit",
    "Plex PMS request redirected too many times",
  );
}

function createPlexPmsSdkClient(
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
    fetch: fetchPlexPmsWithManualRedirects,
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

  try {
    return readPlexPmsResult(
      await request(
        createPlexPmsSdkClient(context, options, controller.signal),
      ),
    );
  } finally {
    clearTimeout(timeout);
  }
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
