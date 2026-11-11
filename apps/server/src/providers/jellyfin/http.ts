import { createHash, randomUUID } from "node:crypto";

import { Jellyfin } from "@jellyfin/sdk";
import { getAuthorizationHeader } from "@jellyfin/sdk/lib/utils/authentication.js";
import axios, { type AxiosResponse, type RawAxiosRequestConfig } from "axios";

import { CLIPARR_CLIENT_VERSION } from "@/config/version";
import { createApiError, isApiError } from "@/http/errors";
import { resolveHostnameAddresses } from "@/providers/shared/dnsCache";
import {
  fetchWithManualRedirects,
  type RedirectFetchPolicy,
} from "@/providers/shared/fetchRedirect";
import {
  DISALLOWED_REMOTE_HOSTNAMES,
  ipv4Octets,
  normalizeHostname,
} from "@/providers/shared/networkPolicy";
import {
  assertHttpUrl,
  booleanEnv,
  errorMessage,
  stringValue,
} from "@/providers/shared/utilities";

/*
Jellyfin HTTP transport: URL security policy, manual-redirect fetch, and the
Jellyfin SDK client. Mirrors the plex module's pmsClient.ts: transport and
security policy live here, domain types and API shapes live in shared.ts.
*/

const JELLYFIN_PRODUCT = "Cliparr";
const JELLYFIN_DEVICE_NAME = "Cliparr";
const JELLYFIN_VERSION = CLIPARR_CLIENT_VERSION;

export const JELLYFIN_REQUEST_TIMEOUT_MS = 5000;
const JELLYFIN_MAX_REDIRECTS = 5;

const ALLOW_LOOPBACK_JELLYFIN_URLS = booleanEnv(
  process.env.CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS,
);

function deriveJellyfinDeviceId() {
  const configured = stringValue(process.env.JELLYFIN_DEVICE_ID);
  if (configured) {
    return configured;
  }

  const appKey = stringValue(process.env.APP_KEY);
  if (appKey) {
    return `cliparr-${createHash("sha256").update(appKey).digest("hex").slice(0, 32)}`;
  }

  return `cliparr-${randomUUID()}`;
}

export const JELLYFIN_DEVICE_ID = deriveJellyfinDeviceId();

export function normalizeBaseUrl(url: string) {
  const parsed = assertHttpUrl(url.trim(), "Jellyfin");
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";

  const normalizedPathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${normalizedPathname === "/" ? "" : normalizedPathname}`;
}

export function isLoopbackHost(hostname: string) {
  const host = normalizeHostname(hostname);
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1" ||
    host.startsWith("127.")
  );
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

function assertAllowedResolvedAddress(
  address: string,
  options: { allowPrivate?: boolean } = {},
) {
  if (
    isUnspecifiedHost(address) ||
    isLinkLocalHost(address) ||
    isMulticastHost(address)
  ) {
    throw createApiError(
      400,
      "invalid_jellyfin_server_url",
      "Jellyfin serverUrl resolved to an unsafe address",
    );
  }

  if (
    (isPrivateHost(address) || isLoopbackHost(address)) &&
    options.allowPrivate !== true
  ) {
    throw createApiError(
      400,
      "invalid_jellyfin_server_url",
      "Jellyfin serverUrl resolved to an unsafe internal address",
    );
  }

  if (isLoopbackHost(address) && !ALLOW_LOOPBACK_JELLYFIN_URLS) {
    throw createApiError(
      400,
      "invalid_jellyfin_server_url",
      "For security, localhost Jellyfin URLs are disabled unless CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS is enabled",
    );
  }
}

const defaultJellyfinServerUrlOptions = { allowPrivate: true };

export async function assertAllowedJellyfinServerUrl(
  url: string,
  options: {
    allowPrivate?: boolean;
    signal?: AbortSignal;
  } = defaultJellyfinServerUrlOptions,
) {
  const signal =
    options.signal ?? AbortSignal.timeout(JELLYFIN_REQUEST_TIMEOUT_MS);
  signal.throwIfAborted();
  const parsed = assertHttpUrl(url.trim(), "Jellyfin");
  const hostname = normalizeHostname(parsed.hostname);

  if (parsed.username || parsed.password) {
    throw createApiError(
      400,
      "invalid_jellyfin_server_url",
      "Jellyfin serverUrl must not include embedded credentials",
    );
  }

  if (DISALLOWED_REMOTE_HOSTNAMES.has(hostname)) {
    throw createApiError(
      400,
      "invalid_jellyfin_server_url",
      "Jellyfin serverUrl must point at your Jellyfin server, not a cloud metadata hostname",
    );
  }

  if (
    isUnspecifiedHost(hostname) ||
    isLinkLocalHost(hostname) ||
    isMulticastHost(hostname)
  ) {
    throw createApiError(
      400,
      "invalid_jellyfin_server_url",
      "Jellyfin serverUrl must point at your Jellyfin server, not an unspecified, link-local, or multicast host",
    );
  }

  assertAllowedResolvedAddress(hostname, options);

  /*
  Shared DNS cache (60s TTL) keeps repeated validations cheap. Error mapping
  is preserved: resolution failures stay 400s, caller timeouts stay 504s.
  */
  const addresses = await resolveHostnameAddresses(hostname, signal).catch(
    () => {
      if (!options.signal && signal.aborted) {
        throw createApiError(
          504,
          "invalid_jellyfin_server_url",
          "Jellyfin serverUrl DNS validation timed out",
        );
      }
      signal.throwIfAborted();
      throw createApiError(
        400,
        "invalid_jellyfin_server_url",
        "Jellyfin serverUrl hostname could not be resolved for security validation",
      );
    },
  );
  signal.throwIfAborted();
  for (const address of addresses) {
    assertAllowedResolvedAddress(address, options);
  }

  return { url: parsed, addresses };
}

export async function resolveCredentialServerUrl(serverUrl: string) {
  const { url } = await assertAllowedJellyfinServerUrl(serverUrl);
  return normalizeBaseUrl(url.toString());
}

async function assertAllowedJellyfinRequestUrl(
  requestUrl: URL,
  trustedOrigin: string,
  signal: AbortSignal,
) {
  const { addresses } = await assertAllowedJellyfinServerUrl(
    requestUrl.toString(),
    {
      allowPrivate: requestUrl.origin === trustedOrigin,
      signal,
    },
  );
  return addresses;
}

const jellyfinRedirectPolicy: RedirectFetchPolicy = {
  maxRedirects: JELLYFIN_MAX_REDIRECTS,
  sensitiveHeaders: [
    "authorization",
    "cookie",
    "x-emby-authorization",
    "x-emby-token",
    "x-mediabrowser-token",
  ],
  assertRequestUrl: assertAllowedJellyfinRequestUrl,
  invalidRedirectError: () =>
    createApiError(
      502,
      "jellyfin_invalid_redirect",
      "Jellyfin server returned an invalid redirect URL",
    ),
  redirectLimitError: () =>
    createApiError(
      502,
      "jellyfin_redirect_limit",
      "Jellyfin request redirected too many times",
    ),
};

function fetchJellyfinWithManualRedirects(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) {
  return fetchWithManualRedirects(input, init, jellyfinRedirectPolicy);
}

const jellyfinAxios = axios.create({
  adapter: "fetch",
  env: {
    fetch: fetchJellyfinWithManualRedirects,
  },
});

function jellyfinDeviceInfo(deviceId = JELLYFIN_DEVICE_ID) {
  return {
    name: JELLYFIN_DEVICE_NAME,
    id: deviceId,
  };
}

const JELLYFIN_CLIENT_INFO = {
  name: JELLYFIN_PRODUCT,
  version: JELLYFIN_VERSION,
};

function createJellyfinApi(options: {
  baseUrl: string;
  token?: string;
  deviceId?: string;
}) {
  const jellyfin = new Jellyfin({
    clientInfo: JELLYFIN_CLIENT_INFO,
    deviceInfo: jellyfinDeviceInfo(options.deviceId),
  });

  return jellyfin.createApi(
    normalizeBaseUrl(options.baseUrl),
    options.token,
    jellyfinAxios,
  );
}

export function jellyfinHeaders(options: {
  headers?: ConstructorParameters<typeof Headers>[0];
  token?: string;
  deviceId?: string;
  accept?: string;
}) {
  const headers = new Headers(options.headers);
  headers.set(
    "Authorization",
    getAuthorizationHeader(
      JELLYFIN_CLIENT_INFO,
      jellyfinDeviceInfo(options.deviceId),
      options.token,
    ),
  );

  if (options.accept) {
    headers.set("Accept", options.accept);
  }

  return headers;
}

interface JellyfinSdkRequestOptions {
  timeoutMs?: number;
  token?: string;
  deviceId?: string;
  signal?: AbortSignal;
  errorCode?: string;
  failureMessage?: string;
  exposeFailureDetail?: boolean;
}

function jellyfinSdkRequestConfig(
  timeoutMs = JELLYFIN_REQUEST_TIMEOUT_MS,
): RawAxiosRequestConfig {
  return {
    timeout: timeoutMs,
    headers: {
      Accept: "application/json",
    },
  };
}

function stringifyHeaderValue(value: unknown) {
  if (value === undefined || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    return value
      .filter(
        (item): item is boolean | number | string =>
          typeof item === "boolean" ||
          typeof item === "number" ||
          typeof item === "string",
      )
      .join(", ");
  }

  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return String(value);
  }

  return;
}

function responseHeader<T>(
  response: AxiosResponse<T>,
  name: string,
): string | undefined {
  const headers = response.headers;
  if (typeof headers.get === "function") {
    return stringifyHeaderValue(headers.get(name));
  }

  const headerRecord = headers as Record<string, unknown>;
  const value =
    headerRecord[name] ??
    headerRecord[name.toLowerCase()] ??
    headerRecord[name.toUpperCase()];
  return stringifyHeaderValue(value);
}

function responseDetail(data: unknown) {
  let detail: string;
  if (typeof data === "string") {
    detail = data;
  } else if (data === undefined) {
    detail = "";
  } else {
    detail = JSON.stringify(data);
  }

  return detail.slice(0, 400).replaceAll(/\s+/g, " ").trim();
}

function axiosRequestUrl(error: unknown, fallbackBaseUrl: string) {
  if (!axios.isAxiosError(error)) {
    return new URL(fallbackBaseUrl);
  }

  const requestUrl = error.config?.url;
  try {
    return new URL(requestUrl ?? "", error.config?.baseURL ?? fallbackBaseUrl);
  } catch {
    return new URL(fallbackBaseUrl);
  }
}

function isAxiosTimeout(error: unknown) {
  return (
    axios.isAxiosError(error) &&
    (error.code === "ETIMEDOUT" ||
      error.code === "ECONNABORTED" ||
      /timeout/i.test(error.message))
  );
}

function toJellyfinSdkError(
  error: unknown,
  baseUrl: string,
  options: JellyfinSdkRequestOptions,
) {
  if (isApiError(error)) {
    return error;
  }

  const errorCode = options.errorCode ?? "jellyfin_request_failed";
  const failureMessage = options.failureMessage ?? "Jellyfin request failed";

  if (axios.isAxiosError(error) && error.response) {
    const exposeFailureDetail = options.exposeFailureDetail ?? true;
    const detail = responseDetail(error.response.data);
    const status =
      !exposeFailureDetail && error.response.status !== 401
        ? 502
        : error.response.status;
    let message = failureMessage;
    if (exposeFailureDetail) {
      message = detail
        ? `${failureMessage}: ${detail}`
        : `${failureMessage}: ${error.response.status} ${error.response.statusText}`;
    }

    return createApiError(status, errorCode, message);
  }

  if (isAxiosTimeout(error)) {
    return createApiError(504, errorCode, `${failureMessage} timed out`);
  }

  const parsed = axiosRequestUrl(error, baseUrl);
  if (isLoopbackHost(parsed.hostname)) {
    return createApiError(
      502,
      errorCode,
      `${options.failureMessage ?? "Could not reach that Jellyfin server"}. If Cliparr is running in Docker, localhost points at the Cliparr container, not your host. Use host.docker.internal or your machine's LAN IP address instead.`,
    );
  }

  return createApiError(
    502,
    errorCode,
    options.exposeFailureDetail === false
      ? failureMessage
      : `${failureMessage}: ${errorMessage(error)}`,
  );
}

export async function jellyfinSdkJson<T>(
  baseUrl: string,
  request: (
    api: ReturnType<typeof createJellyfinApi>,
    config: RawAxiosRequestConfig,
  ) => Promise<AxiosResponse<T>>,
  options: JellyfinSdkRequestOptions = {},
) {
  try {
    const response = await request(
      createJellyfinApi({
        baseUrl,
        token: options.token,
        deviceId: options.deviceId,
      }),
      {
        ...jellyfinSdkRequestConfig(options.timeoutMs),
        signal: options.signal,
      },
    );

    const contentType = responseHeader(response, "content-type") ?? "";
    if (!contentType.toLowerCase().includes("json")) {
      throw createApiError(
        502,
        options.errorCode ?? "jellyfin_invalid_response",
        "That URL did not return the Jellyfin API. Make sure it points at your Jellyfin server base URL.",
      );
    }

    if (response.data === null || typeof response.data !== "object") {
      throw createApiError(
        502,
        options.errorCode ?? "jellyfin_invalid_response",
        "Jellyfin returned an unreadable response. Make sure the server URL is correct and not a login page.",
      );
    }

    return response.data;
  } catch (error) {
    options.signal?.throwIfAborted();
    throw toJellyfinSdkError(error, baseUrl, options);
  }
}
