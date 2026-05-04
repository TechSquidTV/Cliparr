import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import {
  getRequestRouteUrl,
  requestOriginIsPotentiallyTrustworthy,
} from "./requestOrigin.js";
import { getSessionCookieClearOptions, getSessionCookieOptions } from "../session/store.js";

function makeRequest(
  secure: boolean,
  host?: string,
  options?: {
    forwardedHost?: string;
    hostname?: string;
  }
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

      return undefined;
    },
  } as Pick<Request, "get" | "hostname" | "secure">;
}

void test("keeps proxied HTTPS requests secure", () => {
  const req = makeRequest(true, "cliparr.example.com");

  assert.equal(getRequestRouteUrl(req, "/auth/plex/complete"), "https://cliparr.example.com/auth/plex/complete");
  assert.equal(requestOriginIsPotentiallyTrustworthy(req), true);
  assert.equal(getSessionCookieOptions(req.secure).secure, true);
  assert.equal(getSessionCookieClearOptions(req.secure).secure, true);
});

void test("uses the trusted forwarded host for callback URLs when a proxy rewrites Host", () => {
  const req = makeRequest(true, "cliparr:3000", {
    forwardedHost: "cliparr.example.com:8443",
    hostname: "cliparr.example.com",
  });

  assert.equal(
    getRequestRouteUrl(req, "/auth/plex/complete"),
    "https://cliparr.example.com:8443/auth/plex/complete"
  );
});

void test("allows localhost HTTP requests", () => {
  const req = makeRequest(false, "localhost:3000");

  assert.equal(getRequestRouteUrl(req, "/auth/plex/complete"), "http://localhost:3000/auth/plex/complete");
  assert.equal(requestOriginIsPotentiallyTrustworthy(req), true);
  assert.equal(getSessionCookieOptions(req.secure).secure, false);
});

void test("treats loopback IP addresses as potentially trustworthy over HTTP", () => {
  const req = makeRequest(false, "127.0.0.1:3000");

  assert.equal(requestOriginIsPotentiallyTrustworthy(req), true);
});

void test("drops secure-only browser policies for custom HTTP domains", () => {
  const req = makeRequest(false, "cliparr.example.com");

  assert.equal(getRequestRouteUrl(req, "/auth/plex/complete"), "http://cliparr.example.com/auth/plex/complete");
  assert.equal(requestOriginIsPotentiallyTrustworthy(req), false);
  assert.equal(getSessionCookieClearOptions(req.secure).secure, false);
});

void test("rejects invalid host headers before building callback URLs", () => {
  const req = makeRequest(false, "user@example.com");

  assert.throws(
    () => getRequestRouteUrl(req, "/auth/plex/complete"),
    /Request host header is invalid/
  );
});
