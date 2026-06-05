import { isIP } from "node:net";
import type { Request } from "express";
import { createApiError } from "@/http/errors";

type OriginAwareRequest = Pick<Request, "get" | "hostname" | "secure">;

function normalizedHostname(hostname: string) {
  return hostname.replaceAll(/^\[|]$/g, "").toLowerCase();
}

function isValidRequestHost(host: string) {
  return host.length > 0 && !/[\s#/?@\\]/.test(host);
}

function firstHeaderValue(value: string | undefined) {
  const first = value?.split(",")[0]?.trim();
  return first || undefined;
}

function parseAuthority(authority: string, errorCode: string) {
  if (!isValidRequestHost(authority)) {
    throw createApiError(400, errorCode, "Request host header is invalid");
  }

  const url = new URL(`http://${authority}`);
  if (url.username || url.password) {
    throw createApiError(
      400,
      "invalid_request_origin",
      "Request origin is invalid",
    );
  }

  return url;
}

function getRequestHost(request: OriginAwareRequest) {
  const host = firstHeaderValue(request.get("host"));
  if (!host) {
    throw createApiError(
      400,
      "invalid_request_host",
      "Request host header is required",
    );
  }

  return parseAuthority(host, "invalid_request_host");
}

function buildOriginUrl(
  request: OriginAwareRequest,
  hostname: string,
  port = "",
) {
  const url = new URL(
    request.secure ? "https://localhost" : "http://localhost",
  );
  url.hostname = hostname;
  url.port = port;
  return url;
}

function getRequestOriginUrl(request: OriginAwareRequest) {
  const trustedHostname = request.hostname?.trim();
  if (!trustedHostname) {
    throw createApiError(
      400,
      "invalid_request_host",
      "Request host header is required",
    );
  }

  const hostUrl = getRequestHost(request);
  if (
    normalizedHostname(hostUrl.hostname) === normalizedHostname(trustedHostname)
  ) {
    return buildOriginUrl(request, hostUrl.hostname, hostUrl.port);
  }

  const forwardedHost = firstHeaderValue(request.get("x-forwarded-host"));
  if (forwardedHost) {
    const forwardedUrl = parseAuthority(forwardedHost, "invalid_request_host");
    if (
      normalizedHostname(forwardedUrl.hostname) ===
      normalizedHostname(trustedHostname)
    ) {
      return buildOriginUrl(request, forwardedUrl.hostname, forwardedUrl.port);
    }
  }

  return buildOriginUrl(request, trustedHostname);
}

function isLoopbackHostname(hostname: string) {
  const normalized = normalizedHostname(hostname);
  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }

  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return true;
  }

  return isIP(normalized) === 4 && normalized.startsWith("127.");
}

export function getRequestRouteUrl(
  request: OriginAwareRequest,
  pathname: string,
) {
  const url = getRequestOriginUrl(request);
  url.pathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function requestOriginIsPotentiallyTrustworthy(
  request: OriginAwareRequest,
) {
  if (request.secure) {
    return true;
  }

  return isLoopbackHostname(getRequestOriginUrl(request).hostname);
}
