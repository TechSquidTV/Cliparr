import { isUnsafeRemoteHostname } from "@/providers/shared/networkPolicy";
import { resolveHostnameAddresses } from "@/providers/shared/dnsCache";
import { logErrorFields, logEventFields } from "@cliparr/shared/logging";
import { createApiError } from "@/http/errors";
import { getServerLogger, warnWithError } from "@/logging";
import type { MediaHandle } from "@/providers/types";

const logger = getServerLogger(["media", "proxy"]);

export const RELATIVE_MEDIA_BASE_URL = "http://cliparr.local";

export function isAbsoluteUrl(path: string) {
  return /^[a-z][\d+.a-z-]*:/i.test(path);
}

function safeUrl(value: string, base?: string) {
  try {
    return base ? new URL(value, base) : new URL(value);
  } catch {
    return null;
  }
}

export function normalizeMediaPath(path: string) {
  if (isAbsoluteUrl(path)) {
    return path;
  }

  if (!path.startsWith("/")) {
    return `/${path}`;
  }

  return path;
}

export function mediaHandleRequestUrl(
  handle: Pick<MediaHandle, "baseUrl" | "path">,
) {
  return new URL(handle.path, handle.baseUrl);
}

export function shouldAttachProviderAuth(
  handle: Pick<MediaHandle, "baseUrl" | "path">,
) {
  const requestUrl = mediaHandleRequestUrl(handle);
  const providerUrl = safeUrl(handle.baseUrl);
  return providerUrl ? requestUrl.origin === providerUrl.origin : true;
}

function unsafeMediaUrlFields(
  handle: Pick<MediaHandle, "baseUrl" | "path">,
  requestUrl: URL,
  reason: string,
) {
  return {
    ...logEventFields("media.proxy.url_validation", "failure"),
    "media.path": sanitizeLoggedMediaPath(requestUrl.toString()),
    "media.base_path": sanitizeLoggedMediaPath(handle.baseUrl),
    "media.url.hostname": requestUrl.hostname,
    "media.url.reason": reason,
  };
}

function throwUnsafeMediaUrl(
  handle: Pick<MediaHandle, "baseUrl" | "path">,
  requestUrl: URL,
  reason: string,
) {
  logger.warn(
    "Rejected unsafe media URL.",
    unsafeMediaUrlFields(handle, requestUrl, reason),
  );
  throw createApiError(
    400,
    "media_proxy_unsafe_url",
    "Media URL points at an unsafe internal address",
  );
}

export async function assertAllowedMediaHandleRequestUrl(
  handle: Pick<MediaHandle, "baseUrl" | "path" | "providerId">,
  requestUrl = mediaHandleRequestUrl(handle),
  signal = new AbortController().signal,
) {
  signal.throwIfAborted();
  if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") {
    logger.warn(
      "Rejected media URL with unsupported protocol.",
      unsafeMediaUrlFields(handle, requestUrl, "protocol"),
    );
    throw createApiError(
      400,
      "media_proxy_unsafe_url",
      "Media URL must use HTTP or HTTPS",
    );
  }

  if (requestUrl.username || requestUrl.password) {
    throwUnsafeMediaUrl(handle, requestUrl, "credentials");
  }

  const providerUrl = safeUrl(handle.baseUrl);
  if (
    handle.providerId !== "local-url" &&
    providerUrl &&
    requestUrl.origin === providerUrl.origin
  ) {
    return;
  }

  if (isUnsafeRemoteHostname(requestUrl.hostname)) {
    throwUnsafeMediaUrl(handle, requestUrl, "hostname");
  }

  let addresses: string[];
  try {
    addresses = await resolveHostnameAddresses(requestUrl.hostname, signal);
  } catch (error) {
    signal.throwIfAborted();
    warnWithError(logger, error, "Media URL hostname validation failed.", {
      ...unsafeMediaUrlFields(handle, requestUrl, "dns_resolution"),
      ...logErrorFields(error),
    });
    throw createApiError(
      502,
      "media_proxy_unsafe_url",
      "Media URL hostname could not be resolved for security validation",
    );
  }

  for (const address of addresses) {
    if (isUnsafeRemoteHostname(address)) {
      throwUnsafeMediaUrl(handle, requestUrl, "resolved_address");
    }
  }
  return addresses;
}

export function sanitizeLoggedMediaPath(value: string | undefined) {
  if (!value) {
    return value;
  }

  const absoluteUrl = safeUrl(value);
  if (absoluteUrl) {
    return `${absoluteUrl.origin}${absoluteUrl.pathname}`;
  }

  const relativeUrl = safeUrl(
    normalizeMediaPath(value),
    RELATIVE_MEDIA_BASE_URL,
  );
  if (relativeUrl) {
    return relativeUrl.pathname;
  }

  return value.split(/[#?]/, 1)[0] ?? value;
}

function handlePathname(path: string) {
  try {
    return new URL(path, RELATIVE_MEDIA_BASE_URL).pathname.toLowerCase();
  } catch {
    return path.split("?")[0]?.toLowerCase() ?? path.toLowerCase();
  }
}

export function isHlsDerivedHandle(handle: MediaHandle) {
  return (
    Boolean(handle.basePath) || handlePathname(handle.path).endsWith(".m3u8")
  );
}

export function hlsUriKind(path: string) {
  const pathname = handlePathname(path);
  if (pathname.endsWith(".m3u8")) {
    return "playlist";
  }
  if (pathname.endsWith(".ts") || pathname.endsWith(".m4s")) {
    return "segment";
  }
  if (pathname.endsWith(".key")) {
    return "key";
  }
  return "unknown";
}

export function hlsSegmentIndex(path: string): number | undefined {
  const pathname = handlePathname(path);
  const segmentMatch = pathname.match(
    /(?:^|[/_-])(?:segment)?(\d+)\.(?:ts|m4s)$/,
  );
  if (!segmentMatch) {
    return;
  }

  const index = Number(segmentMatch[1]);
  return Number.isSafeInteger(index) ? index : undefined;
}
