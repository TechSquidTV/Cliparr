import { isIP } from "node:net";
import type { Request } from "express";
import { ApiError } from "./errors.js";

type OriginAwareRequest = Pick<Request, "protocol" | "get">;

function getRequestHost(req: OriginAwareRequest) {
  const host = req.get("host");
  if (!host) {
    throw new ApiError(400, "invalid_request_host", "Request host header is required");
  }

  return host;
}

function parseRequestOrigin(req: OriginAwareRequest) {
  try {
    return new URL(`${req.protocol}://${getRequestHost(req)}`);
  } catch {
    throw new ApiError(400, "invalid_request_origin", "Request origin is invalid");
  }
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }

  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return true;
  }

  return isIP(normalized) === 4 && normalized.startsWith("127.");
}

export function getRequestOrigin(req: OriginAwareRequest) {
  return parseRequestOrigin(req).origin;
}

export function getRequestRouteUrl(req: OriginAwareRequest, pathname: string) {
  const url = parseRequestOrigin(req);
  url.pathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function requestUsesSecureTransport(req: OriginAwareRequest) {
  return parseRequestOrigin(req).protocol === "https:";
}

export function requestOriginIsPotentiallyTrustworthy(req: OriginAwareRequest) {
  const origin = parseRequestOrigin(req);
  return origin.protocol === "https:" || (origin.protocol === "http:" && isLoopbackHostname(origin.hostname));
}
