import { isIP } from "node:net";
import type { Request } from "express";
import { ApiError } from "./errors.js";

type OriginAwareRequest = Pick<Request, "get" | "secure">;

function isValidRequestHost(host: string) {
  return host.length > 0 && !/[\s/@\\?#]/.test(host);
}

function getRequestHost(req: OriginAwareRequest) {
  const host = req.get("host");
  if (!host) {
    throw new ApiError(400, "invalid_request_host", "Request host header is required");
  }

  if (!isValidRequestHost(host)) {
    throw new ApiError(400, "invalid_request_host", "Request host header is invalid");
  }

  return host;
}

function getRequestOriginUrl(req: OriginAwareRequest) {
  try {
    const url = new URL(`${req.secure ? "https" : "http"}://${getRequestHost(req)}`);
    if (url.username || url.password) {
      throw new ApiError(400, "invalid_request_origin", "Request origin is invalid");
    }

    return url;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

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
