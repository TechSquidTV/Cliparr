import { createHash, randomUUID } from "crypto";
import { lookup } from "dns/promises";
import { isIP } from "net";
import { CLIPARR_VERSION } from "../../config/version.js";
import type { MediaSource } from "../../db/mediaSourcesRepository.js";
import { ApiError } from "../../http/errors.js";
import { errorMessage, numberValue, stringValue, uniqueStrings } from "../shared/utils.js";

const JELLYFIN_PRODUCT = "Cliparr";
const JELLYFIN_DEVICE_NAME = "Cliparr";
const JELLYFIN_VERSION = CLIPARR_VERSION;

export const JELLYFIN_REQUEST_TIMEOUT_MS = 5000;
const CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS = 5000;

const JELLYFIN_DEV_BASE_URL = stringValue(process.env.CLIPARR_DEV_JELLYFIN_URL);
const ALLOW_LOOPBACK_JELLYFIN_URLS = booleanEnv(process.env.CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS);
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

export function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function booleanEnv(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
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
    throw new ApiError(400, "invalid_connection_url", "Jellyfin connection must use HTTP or HTTPS");
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
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return normalized.slice(1, -1);
  }

  return normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
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

    return uniqueStrings(records.map((record) => normalizeIpCandidate(record.address)));
  } catch {
    throw new ApiError(
      400,
      "invalid_jellyfin_server_url",
      "Jellyfin serverUrl hostname could not be resolved for security validation"
    );
  }
}

function assertAllowedResolvedAddress(address: string) {
  if (isUnspecifiedHost(address) || isLinkLocalHost(address) || isMulticastHost(address)) {
    throw new ApiError(
      400,
      "invalid_jellyfin_server_url",
      "Jellyfin serverUrl resolved to an unsafe address"
    );
  }

  if (isLoopbackHost(address) && !ALLOW_LOOPBACK_JELLYFIN_URLS && !JELLYFIN_DEV_BASE_URL) {
    throw new ApiError(
      400,
      "invalid_jellyfin_server_url",
      "For security, localhost Jellyfin URLs are disabled unless CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS is enabled"
    );
  }
}

async function assertAllowedJellyfinServerUrl(url: string) {
  const parsed = assertHttpUrl(url.trim());
  const hostname = normalizeHostname(parsed.hostname);

  if (DISALLOWED_JELLYFIN_HOSTNAMES.has(hostname)) {
    throw new ApiError(
      400,
      "invalid_jellyfin_server_url",
      "Jellyfin serverUrl must point at your Jellyfin server, not a cloud metadata hostname"
    );
  }

  if (isUnspecifiedHost(hostname) || isLinkLocalHost(hostname) || isMulticastHost(hostname)) {
    throw new ApiError(
      400,
      "invalid_jellyfin_server_url",
      "Jellyfin serverUrl must point at your Jellyfin server, not an unspecified, link-local, or multicast host"
    );
  }

  assertAllowedResolvedAddress(hostname);

  for (const address of await resolveHostnameAddresses(hostname)) {
    assertAllowedResolvedAddress(address);
  }

  return parsed;
}

export async function resolveCredentialServerUrl(serverUrl: string) {
  return resolveJellyfinBaseUrl((await assertAllowedJellyfinServerUrl(serverUrl)).toString());
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
  const isDefaultHttp = parsed.protocol === "http:" && (port === undefined || port === 80);
  const isDefaultHttps = parsed.protocol === "https:" && (port === undefined || port === 443);
  const label = port === undefined || isDefaultHttp || isDefaultHttps
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

export function jellyfinSourceName(serverName: unknown, baseUrl: string) {
  const normalizedServerName = stringValue(serverName);
  if (normalizedServerName && !looksLikeGeneratedServerName(normalizedServerName)) {
    return normalizedServerName;
  }

  const hostInfo = sourceHostInfo(baseUrl);
  if (!hostInfo || hostInfo.hostname.toLowerCase() === "jellyfin" || isLoopbackHost(hostInfo.hostname)) {
    return "Jellyfin";
  }

  return `Jellyfin (${hostInfo.label})`;
}

function buildJellyfinUrl(baseUrl: string, path: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    return assertHttpUrl(path);
  }

  const base = assertHttpUrl(baseUrl);
  const relative = new URL(path, "http://cliparr.local");
  const basePath = base.pathname === "/" ? "" : base.pathname.replace(/\/+$/, "");
  const next = new URL(base.origin);
  next.pathname = `${basePath}${relative.pathname.startsWith("/") ? relative.pathname : `/${relative.pathname}`}`;
  next.search = relative.search;
  next.hash = "";
  return next;
}

function isLocalConnection(url: URL) {
  const host = url.hostname.toLowerCase();
  return host === "localhost"
    || host === "::1"
    || host === "[::1]"
    || host.startsWith("127.")
    || host.startsWith("10.")
    || host.startsWith("192.168.")
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
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

function jellyfinAuthorization(token?: string, deviceId = JELLYFIN_DEVICE_ID) {
  const fields = [
    ["Client", JELLYFIN_PRODUCT],
    ["Device", JELLYFIN_DEVICE_NAME],
    ["DeviceId", deviceId],
    ["Version", JELLYFIN_VERSION],
    ...(token ? [["Token", token]] as const : []),
  ];

  return `MediaBrowser ${fields
    .map(([key, value]) => `${key}="${encodeURIComponent(value)}"`)
    .join(", ")}`;
}

export function jellyfinHeaders(options: {
  headers?: ConstructorParameters<typeof Headers>[0];
  token?: string;
  deviceId?: string;
  accept?: string;
}) {
  const headers = new Headers(options.headers);
  headers.set("Authorization", jellyfinAuthorization(options.token, options.deviceId));

  if (options.accept) {
    headers.set("Accept", options.accept);
  }

  return headers;
}

export async function jellyfinFetch(
  url: string,
  init: RequestInit = {},
  options: {
    token?: string;
    deviceId?: string;
    accept?: string;
    timeoutMs?: number;
    errorCode?: string;
    failureMessage?: string;
    exposeFailureDetail?: boolean;
  } = {}
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? JELLYFIN_REQUEST_TIMEOUT_MS);
  const headers = jellyfinHeaders({
    headers: init.headers,
    token: options.token,
    deviceId: options.deviceId,
    accept: options.accept,
  });

  try {
    const response = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });

    if (!response.ok && response.status !== 206) {
      const failureMessage = options.failureMessage ?? "Jellyfin request failed";
      const exposeFailureDetail = options.exposeFailureDetail ?? true;
      const detail = (await response.text().catch(() => ""))
        .slice(0, 400)
        .replace(/\s+/g, " ")
        .trim();

      throw new ApiError(
        !exposeFailureDetail && response.status !== 401 ? 502 : response.status,
        options.errorCode ?? "jellyfin_request_failed",
        !exposeFailureDetail
          ? failureMessage
          : detail
            ? `${failureMessage}: ${detail}`
            : `${failureMessage}: ${response.status} ${response.statusText}`
      );
    }

    return response;
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }

    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError(
        504,
        options.errorCode ?? "jellyfin_request_failed",
        options.failureMessage ?? "Jellyfin request timed out"
      );
    }

    const parsed = new URL(url);
    if (JELLYFIN_DEV_BASE_URL && isLoopbackHost(parsed.hostname)) {
      throw new ApiError(
        502,
        options.errorCode ?? "jellyfin_request_failed",
        `${options.failureMessage ?? "Could not reach that Jellyfin server"}. Cliparr is running in Docker, so localhost points at the Cliparr container. Use ${JELLYFIN_DEV_BASE_URL} for this dev setup.`
      );
    }

    throw new ApiError(
      502,
      options.errorCode ?? "jellyfin_request_failed",
      options.exposeFailureDetail === false
        ? options.failureMessage ?? "Jellyfin request failed"
        : `${options.failureMessage ?? "Jellyfin request failed"}: ${errorMessage(err)}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function jellyfinJson<T>(
  baseUrl: string,
  path: string,
  options: {
    token?: string;
    deviceId?: string;
    timeoutMs?: number;
    method?: string;
    body?: string;
    errorCode?: string;
    failureMessage?: string;
    exposeFailureDetail?: boolean;
  } = {}
) {
  const url = buildJellyfinUrl(baseUrl, path);
  const response = await jellyfinFetch(url.toString(), {
    method: options.method,
    body: options.body,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
  }, {
    ...options,
    accept: "application/json",
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("json")) {
    throw new ApiError(
      502,
      options.errorCode ?? "jellyfin_invalid_response",
      "That URL did not return the Jellyfin API. Make sure it points at your Jellyfin server base URL."
    );
  }

  try {
    return await response.json() as T;
  } catch {
    throw new ApiError(
      502,
      options.errorCode ?? "jellyfin_invalid_response",
      "Jellyfin returned an unreadable response. Make sure the server URL is correct and not a login page."
    );
  }
}

export function sourceContext(source: MediaSource): JellyfinSourceContext {
  const token = stringValue(source.credentials.accessToken);
  const userId = stringValue(source.credentials.userId) ?? stringValue(source.metadata.userId);
  const deviceId = stringValue(source.credentials.deviceId) ?? JELLYFIN_DEVICE_ID;

  if (!token) {
    throw new ApiError(
      500,
      "source_credentials_missing",
      "Stored Jellyfin source is missing its access token"
    );
  }

  if (!userId) {
    throw new ApiError(
      500,
      "source_credentials_missing",
      "Stored Jellyfin source is missing its Jellyfin user id"
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
  return jellyfinJson<any>(context.baseUrl, "/Users/Me", {
    token: context.token,
    deviceId: context.deviceId,
    timeoutMs: JELLYFIN_REQUEST_TIMEOUT_MS,
    errorCode: "jellyfin_auth_failed",
    failureMessage: "Jellyfin authentication failed",
  });
}

export async function fetchSessions(context: JellyfinSourceContext) {
  return jellyfinJson<any[]>(context.baseUrl, "/Sessions?activeWithinSeconds=300", {
    token: context.token,
    deviceId: context.deviceId,
    timeoutMs: CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
    errorCode: "jellyfin_sessions_failed",
    failureMessage: "Jellyfin sessions request failed",
  });
}

export async function fetchItem(context: JellyfinSourceContext, itemId: string) {
  return jellyfinJson<any>(
    context.baseUrl,
    `/Items/${encodeURIComponent(itemId)}?userId=${encodeURIComponent(context.userId)}`,
    {
      token: context.token,
      deviceId: context.deviceId,
      timeoutMs: CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
      errorCode: "jellyfin_item_failed",
      failureMessage: "Jellyfin item request failed",
    }
  );
}
