import { isIP } from "node:net";
import type { Request } from "express";
import { ApiError } from "./errors.js";

type OriginAwareRequest = Pick<Request, "get" | "hostname" | "secure">;

function normalizedHostname(hostname: string) {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function isValidRequestHost(host: string) {
  return host.length > 0 && !/[\s/@\\?#]/.test(host);
}

function firstHeaderValue(value: string | undefined) {
  const first = value?.split(",")[0]?.trim();
  return first || undefined;
}

function parseAuthority(authority: string, errorCode: string) {
  if (!isValidRequestHost(authority)) {
    throw new ApiError(400, errorCode, "Request host header is invalid");
  }

  const url = new URL(`http://${authority}`);
  if (url.username || url.password) {
    throw new ApiError(400, "invalid_request_origin", "Request origin is invalid");
  }

  return url;
}

function getRequestHost(req: OriginAwareRequest) {
  const host = firstHeaderValue(req.get("host"));
  if (!host) {
    throw new ApiError(400, "invalid_request_host", "Request host header is required");
  }

  return parseAuthority(host, "invalid_request_host");
}

function buildOriginUrl(req: OriginAwareRequest, hostname: string, port = "") {
  const url = new URL(req.secure ? "https://localhost" : "http://localhost");
  url.hostname = hostname;
  url.port = port;
  return url;
}

function getRequestOriginUrl(req: OriginAwareRequest) {
  const trustedHostname = req.hostname?.trim();
  if (!trustedHostname) {
    throw new ApiError(400, "invalid_request_host", "Request host header is required");
  }

  const hostUrl = getRequestHost(req);
  if (normalizedHostname(hostUrl.hostname) === normalizedHostname(trustedHostname)) {
    return buildOriginUrl(req, hostUrl.hostname, hostUrl.port);
  }

  const forwardedHost = firstHeaderValue(req.get("x-forwarded-host"));
  if (forwardedHost) {
    const forwardedUrl = parseAuthority(forwardedHost, "invalid_request_host");
    if (normalizedHostname(forwardedUrl.hostname) === normalizedHostname(trustedHostname)) {
      return buildOriginUrl(req, forwardedUrl.hostname, forwardedUrl.port);
    }
  }

  return buildOriginUrl(req, trustedHostname);
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

export function getRequestRouteUrl(req: OriginAwareRequest, pathname: string) {
  const url = getRequestOriginUrl(req);
  url.pathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function requestOriginIsPotentiallyTrustworthy(req: OriginAwareRequest) {
  if (req.secure) {
    return true;
  }

  return isLoopbackHostname(getRequestOriginUrl(req).hostname);
}
