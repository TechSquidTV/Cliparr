import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import {
  getRequestRouteUrl,
  requestOriginIsPotentiallyTrustworthy,
} from "@/http/requestOrigin";
import {
  getSessionCookieClearOptions,
  getSessionCookieOptions,
} from "@/session/store";

function makeRequest(
  secure: boolean,
  host?: string,
  options?: {
    forwardedHost?: string;
    hostname?: string;
  },
): Pick<Request, "get" | "hostname" | "secure"> {
  return {
    secure,
    hostname: options?.hostname ?? host?.split(":")[0] ?? "",
    get(name: string) {
      const normalized = name.toLowerCase();
      if (normalized === "host") {
        return host;
      }

      if (normalized === "x-forwarded-host") {
        return options?.forwardedHost;
      }

      return;
    },
  } as Pick<Request, "get" | "hostname" | "secure">;
}

void test("keeps proxied HTTPS requests secure", () => {
  const request = makeRequest(true, "cliparr.example.com");

  assert.equal(
    getRequestRouteUrl(request, "/auth/plex/complete"),
    "https://cliparr.example.com/auth/plex/complete",
  );
  assert.equal(requestOriginIsPotentiallyTrustworthy(request), true);
  assert.equal(getSessionCookieOptions(request.secure).secure, true);
  assert.equal(getSessionCookieClearOptions(request.secure).secure, true);
});

void test("uses the trusted forwarded host for callback URLs when a proxy rewrites Host", () => {
  const request = makeRequest(true, "cliparr:3000", {
    forwardedHost: "cliparr.example.com:8443",
    hostname: "cliparr.example.com",
  });

  assert.equal(
    getRequestRouteUrl(request, "/auth/plex/complete"),
    "https://cliparr.example.com:8443/auth/plex/complete",
  );
});

void test("allows localhost HTTP requests", () => {
  const request = makeRequest(false, "localhost:3000");

  assert.equal(
    getRequestRouteUrl(request, "/auth/plex/complete"),
    "http://localhost:3000/auth/plex/complete",
  );
  assert.equal(requestOriginIsPotentiallyTrustworthy(request), true);
  assert.equal(getSessionCookieOptions(request.secure).secure, false);
});

void test("treats loopback IP addresses as potentially trustworthy over HTTP", () => {
  const request = makeRequest(false, "127.0.0.1:3000");

  assert.equal(requestOriginIsPotentiallyTrustworthy(request), true);
});

void test("drops secure-only browser policies for custom HTTP domains", () => {
  const request = makeRequest(false, "cliparr.example.com");

  assert.equal(
    getRequestRouteUrl(request, "/auth/plex/complete"),
    "http://cliparr.example.com/auth/plex/complete",
  );
  assert.equal(requestOriginIsPotentiallyTrustworthy(request), false);
  assert.equal(getSessionCookieClearOptions(request.secure).secure, false);
});

void test("rejects invalid host headers before building callback URLs", () => {
  const request = makeRequest(false, "user@example.com");

  assert.throws(
    () => getRequestRouteUrl(request, "/auth/plex/complete"),
    /Request host header is invalid/,
  );
});
