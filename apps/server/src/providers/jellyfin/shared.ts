import { createHash, randomUUID } from "crypto";
import { lookup } from "dns/promises";
import { isIP } from "net";
import axios, { type AxiosResponse, type RawAxiosRequestConfig } from "axios";
import { Jellyfin } from "@jellyfin/sdk";
import type {
  AuthenticationResult,
  BaseItemDto,
  MediaSourceInfo,
  MediaStream,
  PlaybackInfoResponse,
  PublicSystemInfo,
  SessionInfoDto,
  UserDto,
} from "@jellyfin/sdk/lib/generated-client/models/index.js";
import {
  getMediaInfoApi,
  getSessionApi,
  getSystemApi,
  getUserApi,
  getUserLibraryApi,
} from "@jellyfin/sdk/lib/utils/api/index.js";
import { getAuthorizationHeader } from "@jellyfin/sdk/lib/utils/authentication.js";
import { CLIPARR_CLIENT_VERSION } from "@/config/version";
import type { MediaSource } from "@/db/mediaSourcesRepository";
import { createApiError, isApiError } from "@/http/errors";
import {
  errorMessage,
  numberValue,
  stringValue,
  uniqueStrings,
} from "@/providers/shared/utils";

const JELLYFIN_PRODUCT = "Cliparr";
const JELLYFIN_DEVICE_NAME = "Cliparr";
const JELLYFIN_VERSION = CLIPARR_CLIENT_VERSION;

export const JELLYFIN_REQUEST_TIMEOUT_MS = 5000;
const CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS = 5000;
const JELLYFIN_MAX_REDIRECTS = 5;

const JELLYFIN_DEV_BASE_URL = stringValue(process.env.CLIPARR_DEV_JELLYFIN_URL);
const ALLOW_LOOPBACK_JELLYFIN_URLS = booleanEnv(
  process.env.CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS,
);
const DISALLOWED_JELLYFIN_HOSTNAMES = new Set([
  "metadata",
  "metadata.azure.internal",
  "metadata.google.internal",
]);

export interface JellyfinSourceContext {
  sourceId: string;
  baseUrl: string;
  token: string;
  userId: string;
  deviceId: string;
}

export type JellyfinMediaStream = Omit<MediaStream, "Type"> & {
  Type?: string;
};

type JellyfinMediaSource = Omit<MediaSourceInfo, "MediaStreams"> & {
  MediaStreams?: JellyfinMediaStream[] | null;
};

type JellyfinStudio = NonNullable<
  NonNullable<BaseItemDto["Studios"]>[number]
> & {
  name?: string | null;
};

export type JellyfinItem = Omit<
  BaseItemDto,
  "MediaSources" | "MediaType" | "Studios" | "Type"
> & {
  MediaSources?: JellyfinMediaSource[] | null;
  MediaType?: string;
  Studios?: JellyfinStudio[] | null;
  Type?: string;
};

export type JellyfinSessionInfo = Omit<
  SessionInfoDto,
  "NowPlayingItem" | "PlayState"
> & {
  NowPlayingItem?: JellyfinItem | null;
  PlayState?: SessionInfoDto["PlayState"] | null;
};

export type JellyfinPlaybackInfo = Omit<
  PlaybackInfoResponse,
  "MediaSources"
> & {
  MediaSources?: JellyfinMediaSource[];
};

export type JellyfinPublicSystemInfo = PublicSystemInfo;
export type JellyfinUser = UserDto;
export type JellyfinAuthenticationResult = AuthenticationResult;

export function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function booleanEnv(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

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

function assertHttpUrl(uri: string) {
  const parsed = new URL(uri);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw createApiError(
      400,
      "invalid_connection_url",
      "Jellyfin connection must use HTTP or HTTPS",
    );
  }

  return parsed;
}

export function normalizeBaseUrl(url: string) {
  const parsed = assertHttpUrl(url.trim());
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";

  const normalizedPathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${normalizedPathname === "/" ? "" : normalizedPathname}`;
}

function isLoopbackHost(hostname: string) {
  const host = normalizeHostname(hostname);
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

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

function isUnspecifiedHost(hostname: string) {
  const host = normalizeHostname(hostname);
  return host === "0.0.0.0" || host === "::";
}

function isLinkLocalHost(hostname: string) {
  const host = normalizeHostname(hostname);
  return host.startsWith("169.254.") || /^fe[89ab][0-9a-f]:/i.test(host);
}

function ipv4Octets(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return undefined;
  }

  const octets = parts.map((part) => Number(part));
  if (
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return undefined;
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
    return undefined;
  }

  const parsedWords = words.map((word) => Number.parseInt(word, 16));
  if (
    words.some(
      (word, index) =>
        !/^[0-9a-f]{1,4}$/i.test(word) ||
        !Number.isInteger(parsedWords[index]) ||
        parsedWords[index] < 0 ||
        parsedWords[index] > 0xffff,
    )
  ) {
    return undefined;
  }

  const [high, low] = parsedWords as [number, number];
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
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

  return /^f[cd][0-9a-f]{2}:/i.test(host);
}

function isMulticastHost(hostname: string) {
  const host = normalizeHostname(hostname);
  if (/^ff[0-9a-f]{2}:/i.test(host)) {
    return true;
  }

  const firstOctet = Number(host.split(".")[0]);
  return Number.isInteger(firstOctet) && firstOctet >= 224 && firstOctet <= 239;
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
      "invalid_jellyfin_server_url",
      "Jellyfin serverUrl hostname could not be resolved for security validation",
    );
  }
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

  if (isPrivateHost(address) && options.allowPrivate !== true) {
    throw createApiError(
      400,
      "invalid_jellyfin_server_url",
      "Jellyfin serverUrl resolved to an unsafe internal address",
    );
  }

  if (
    isLoopbackHost(address) &&
    !ALLOW_LOOPBACK_JELLYFIN_URLS &&
    !JELLYFIN_DEV_BASE_URL
  ) {
    throw createApiError(
      400,
      "invalid_jellyfin_server_url",
      "For security, localhost Jellyfin URLs are disabled unless CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS is enabled",
    );
  }
}

async function assertAllowedJellyfinServerUrl(
  url: string,
  options: { allowPrivate?: boolean } = { allowPrivate: true },
) {
  const parsed = assertHttpUrl(url.trim());
  const hostname = normalizeHostname(parsed.hostname);

  if (parsed.username || parsed.password) {
    throw createApiError(
      400,
      "invalid_jellyfin_server_url",
      "Jellyfin serverUrl must not include embedded credentials",
    );
  }

  if (DISALLOWED_JELLYFIN_HOSTNAMES.has(hostname)) {
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

  for (const address of await resolveHostnameAddresses(hostname)) {
    assertAllowedResolvedAddress(address, options);
  }

  return parsed;
}

export async function resolveCredentialServerUrl(serverUrl: string) {
  return resolveJellyfinBaseUrl(
    (await assertAllowedJellyfinServerUrl(serverUrl)).toString(),
  );
}

function resolveJellyfinBaseUrl(url: string) {
  const normalized = normalizeBaseUrl(url);
  if (!JELLYFIN_DEV_BASE_URL) {
    return normalized;
  }

  const parsed = assertHttpUrl(normalized);
  if (!isLoopbackHost(parsed.hostname)) {
    return normalized;
  }

  return normalizeBaseUrl(JELLYFIN_DEV_BASE_URL);
}

function sourceHostInfo(baseUrl: string) {
  const parsed = assertHttpUrl(baseUrl);
  const hostname = parsed.hostname.trim();
  if (!hostname) {
    return undefined;
  }

  const port = parsed.port ? numberValue(parsed.port) : undefined;
  const isDefaultHttp =
    parsed.protocol === "http:" && (port === undefined || port === 80);
  const isDefaultHttps =
    parsed.protocol === "https:" && (port === undefined || port === 443);
  const label =
    port === undefined || isDefaultHttp || isDefaultHttps
      ? hostname
      : `${hostname}:${port}`;

  return {
    hostname,
    label,
  };
}

function looksLikeGeneratedServerName(value: string) {
  return /^[a-f0-9]{12,64}$/i.test(value.trim());
}

export function jellyfinSourceName(
  serverName: string | null | undefined,
  baseUrl: string,
) {
  const normalizedServerName = stringValue(serverName);
  if (
    normalizedServerName &&
    !looksLikeGeneratedServerName(normalizedServerName)
  ) {
    return normalizedServerName;
  }

  const hostInfo = sourceHostInfo(baseUrl);
  if (
    !hostInfo ||
    hostInfo.hostname.toLowerCase() === "jellyfin" ||
    isLoopbackHost(hostInfo.hostname)
  ) {
    return "Jellyfin";
  }

  return `Jellyfin (${hostInfo.label})`;
}

function isLocalConnection(url: URL) {
  const host = url.hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
}

export function connectionInfo(baseUrl: string) {
  const parsed = assertHttpUrl(baseUrl);
  return {
    id: parsed.toString(),
    uri: baseUrl,
    local: isLocalConnection(parsed),
    relay: false,
    protocol: parsed.protocol.slice(0, -1),
    address: parsed.hostname,
    port: numberValue(parsed.port) ?? (parsed.protocol === "https:" ? 443 : 80),
  };
}

const JELLYFIN_CLIENT_INFO = {
  name: JELLYFIN_PRODUCT,
  version: JELLYFIN_VERSION,
};

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
    return undefined;
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("json") || contentType.startsWith("text/")) {
    return request.clone().text();
  }

  return request.clone().arrayBuffer();
}

async function closeRedirectResponse(response: globalThis.Response) {
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
      "jellyfin_invalid_redirect",
      "Jellyfin server returned an invalid redirect URL",
    );
  }
}

function updateRedirectRequest(
  init: RequestInit,
  response: globalThis.Response,
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
    headers.delete("x-emby-authorization");
    headers.delete("x-emby-token");
    headers.delete("x-mediabrowser-token");
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

async function assertAllowedJellyfinRequestUrl(
  requestUrl: URL,
  trustedOrigin: string,
) {
  const parsed = assertHttpUrl(requestUrl.toString());
  if (parsed.username || parsed.password) {
    throw createApiError(
      400,
      "invalid_jellyfin_server_url",
      "Jellyfin serverUrl must not include embedded credentials",
    );
  }

  if (requestUrl.origin === trustedOrigin) {
    return;
  }

  await assertAllowedJellyfinServerUrl(requestUrl.toString(), {
    allowPrivate: false,
  });
}

async function fetchJellyfinWithManualRedirects(
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
    redirectCount <= JELLYFIN_MAX_REDIRECTS;
    redirectCount += 1
  ) {
    await assertAllowedJellyfinRequestUrl(requestUrl, trustedOrigin);

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
    "jellyfin_redirect_limit",
    "Jellyfin request redirected too many times",
  );
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
  token?: string;
  deviceId?: string;
  timeoutMs?: number;
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

function responseHeader<T>(
  response: AxiosResponse<T>,
  name: string,
): string | undefined {
  function stringifyHeaderValue(value: unknown) {
    if (value === undefined || value === null) {
      return undefined;
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

    return undefined;
  }

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
  const detail =
    typeof data === "string"
      ? data
      : data === undefined
        ? ""
        : JSON.stringify(data);

  return detail.slice(0, 400).replace(/\s+/g, " ").trim();
}

function axiosRequestUrl(err: unknown, fallbackBaseUrl: string) {
  if (!axios.isAxiosError(err)) {
    return new URL(fallbackBaseUrl);
  }

  const requestUrl = err.config?.url;
  try {
    return new URL(requestUrl ?? "", err.config?.baseURL ?? fallbackBaseUrl);
  } catch {
    return new URL(fallbackBaseUrl);
  }
}

function isAxiosTimeout(err: unknown) {
  return (
    axios.isAxiosError(err) &&
    (err.code === "ETIMEDOUT" ||
      err.code === "ECONNABORTED" ||
      /timeout/i.test(err.message))
  );
}

function toJellyfinSdkError(
  err: unknown,
  baseUrl: string,
  options: JellyfinSdkRequestOptions,
) {
  if (isApiError(err)) {
    return err;
  }

  const errorCode = options.errorCode ?? "jellyfin_request_failed";
  const failureMessage = options.failureMessage ?? "Jellyfin request failed";

  if (axios.isAxiosError(err) && err.response) {
    const exposeFailureDetail = options.exposeFailureDetail ?? true;
    const detail = responseDetail(err.response.data);
    return createApiError(
      !exposeFailureDetail && err.response.status !== 401
        ? 502
        : err.response.status,
      errorCode,
      !exposeFailureDetail
        ? failureMessage
        : detail
          ? `${failureMessage}: ${detail}`
          : `${failureMessage}: ${err.response.status} ${err.response.statusText}`,
    );
  }

  if (isAxiosTimeout(err)) {
    return createApiError(504, errorCode, `${failureMessage} timed out`);
  }

  const parsed = axiosRequestUrl(err, baseUrl);
  if (JELLYFIN_DEV_BASE_URL && isLoopbackHost(parsed.hostname)) {
    return createApiError(
      502,
      errorCode,
      `${options.failureMessage ?? "Could not reach that Jellyfin server"}. Cliparr is running in Docker, so localhost points at the Cliparr container. Use ${JELLYFIN_DEV_BASE_URL} for this dev setup.`,
    );
  }

  return createApiError(
    502,
    errorCode,
    options.exposeFailureDetail === false
      ? failureMessage
      : `${failureMessage}: ${errorMessage(err)}`,
  );
}

async function jellyfinSdkJson<T>(
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
      jellyfinSdkRequestConfig(options.timeoutMs),
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
  } catch (err) {
    throw toJellyfinSdkError(err, baseUrl, options);
  }
}

export function sourceContext(source: MediaSource): JellyfinSourceContext {
  const token = stringValue(source.credentials.accessToken);
  const userId =
    stringValue(source.credentials.userId) ??
    stringValue(source.metadata.userId);
  const deviceId =
    stringValue(source.credentials.deviceId) ?? JELLYFIN_DEVICE_ID;

  if (!token) {
    throw createApiError(
      500,
      "source_credentials_missing",
      "Stored Jellyfin source is missing its access token",
    );
  }

  if (!userId) {
    throw createApiError(
      500,
      "source_credentials_missing",
      "Stored Jellyfin source is missing its Jellyfin user id",
    );
  }

  return {
    sourceId: source.id,
    baseUrl: resolveJellyfinBaseUrl(source.baseUrl),
    token,
    userId,
    deviceId,
  };
}

export async function fetchCurrentUser(context: JellyfinSourceContext) {
  return jellyfinSdkJson<JellyfinUser>(
    context.baseUrl,
    (api, config) => getUserApi(api).getCurrentUser(config),
    {
      token: context.token,
      deviceId: context.deviceId,
      timeoutMs: JELLYFIN_REQUEST_TIMEOUT_MS,
      errorCode: "jellyfin_auth_failed",
      failureMessage: "Jellyfin authentication failed",
    },
  );
}

export async function fetchPublicSystemInfo(options: {
  baseUrl: string;
  deviceId?: string;
  timeoutMs?: number;
  errorCode?: string;
  failureMessage?: string;
  exposeFailureDetail?: boolean;
}) {
  return jellyfinSdkJson<JellyfinPublicSystemInfo>(
    options.baseUrl,
    (api, config) => getSystemApi(api).getPublicSystemInfo(config),
    {
      deviceId: options.deviceId,
      timeoutMs: options.timeoutMs,
      errorCode: options.errorCode,
      failureMessage: options.failureMessage,
      exposeFailureDetail: options.exposeFailureDetail,
    },
  );
}

export async function authenticateJellyfinUser(options: {
  baseUrl: string;
  username: string;
  password: string;
  deviceId?: string;
  timeoutMs?: number;
  errorCode?: string;
  failureMessage?: string;
  exposeFailureDetail?: boolean;
}) {
  return jellyfinSdkJson<JellyfinAuthenticationResult>(
    options.baseUrl,
    (api, config) =>
      getUserApi(api).authenticateUserByName(
        {
          authenticateUserByName: {
            Username: options.username,
            Pw: options.password,
          },
        },
        config,
      ),
    {
      deviceId: options.deviceId,
      timeoutMs: options.timeoutMs,
      errorCode: options.errorCode,
      failureMessage: options.failureMessage,
      exposeFailureDetail: options.exposeFailureDetail,
    },
  );
}

export async function fetchSessions(context: JellyfinSourceContext) {
  return jellyfinSdkJson<JellyfinSessionInfo[]>(
    context.baseUrl,
    (api, config) =>
      getSessionApi(api).getSessions(
        {
          activeWithinSeconds: 300,
        },
        config,
      ),
    {
      token: context.token,
      deviceId: context.deviceId,
      timeoutMs: CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
      errorCode: "jellyfin_sessions_failed",
      failureMessage: "Jellyfin sessions request failed",
    },
  );
}

export async function fetchItem(
  context: JellyfinSourceContext,
  itemId: string,
) {
  return jellyfinSdkJson<JellyfinItem>(
    context.baseUrl,
    (api, config) =>
      getUserLibraryApi(api).getItem(
        {
          itemId,
          userId: context.userId,
        },
        config,
      ),
    {
      token: context.token,
      deviceId: context.deviceId,
      timeoutMs: CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
      errorCode: "jellyfin_item_failed",
      failureMessage: "Jellyfin item request failed",
    },
  );
}

export async function fetchPlaybackInfo(
  context: JellyfinSourceContext,
  itemId: string,
) {
  return jellyfinSdkJson<JellyfinPlaybackInfo>(
    context.baseUrl,
    (api, config) =>
      getMediaInfoApi(api).getPlaybackInfo(
        {
          itemId,
          userId: context.userId,
        },
        config,
      ),
    {
      token: context.token,
      deviceId: context.deviceId,
      timeoutMs: CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
      errorCode: "jellyfin_playback_info_failed",
      failureMessage: "Jellyfin playback info request failed",
    },
  );
}
