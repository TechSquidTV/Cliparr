import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import {
  getRequestOrigin,
  getRequestRouteUrl,
  requestOriginIsPotentiallyTrustworthy,
  requestUsesSecureTransport,
} from "./requestOrigin.js";
import { getClearSessionCookieHeader, getSessionCookieHeader } from "../session/store.js";

function makeRequest(protocol: string, host?: string): Pick<Request, "protocol" | "get"> {
  return {
    protocol,
    get(name: string) {
      return name.toLowerCase() === "host" ? host : undefined;
    },
  } as Pick<Request, "protocol" | "get">;
}

void test("keeps proxied HTTPS requests secure", () => {
  const req = makeRequest("https", "cliparr.example.com");

  assert.equal(getRequestOrigin(req), "https://cliparr.example.com");
  assert.equal(getRequestRouteUrl(req, "/auth/plex/complete"), "https://cliparr.example.com/auth/plex/complete");
  assert.equal(requestUsesSecureTransport(req), true);
  assert.equal(requestOriginIsPotentiallyTrustworthy(req), true);
  assert.match(getSessionCookieHeader("session-123", { secure: requestUsesSecureTransport(req) }), /; Secure$/);
  assert.match(getClearSessionCookieHeader({ secure: requestUsesSecureTransport(req) }), /; Secure$/);
});

void test("allows localhost HTTP requests", () => {
  const req = makeRequest("http", "localhost:3000");

  assert.equal(getRequestOrigin(req), "http://localhost:3000");
  assert.equal(getRequestRouteUrl(req, "/auth/plex/complete"), "http://localhost:3000/auth/plex/complete");
  assert.equal(requestUsesSecureTransport(req), false);
  assert.equal(requestOriginIsPotentiallyTrustworthy(req), true);
  assert.doesNotMatch(
    getSessionCookieHeader("session-123", { secure: requestUsesSecureTransport(req) }),
    /; Secure$/
  );
});

void test("treats loopback IP addresses as potentially trustworthy over HTTP", () => {
  const req = makeRequest("http", "127.0.0.1:3000");

  assert.equal(requestUsesSecureTransport(req), false);
  assert.equal(requestOriginIsPotentiallyTrustworthy(req), true);
});

void test("drops secure-only browser policies for custom HTTP domains", () => {
  const req = makeRequest("http", "cliparr.example.com");

  assert.equal(getRequestOrigin(req), "http://cliparr.example.com");
  assert.equal(getRequestRouteUrl(req, "/auth/plex/complete"), "http://cliparr.example.com/auth/plex/complete");
  assert.equal(requestUsesSecureTransport(req), false);
  assert.equal(requestOriginIsPotentiallyTrustworthy(req), false);
  assert.doesNotMatch(
    getSessionCookieHeader("session-123", { secure: requestUsesSecureTransport(req) }),
    /; Secure$/
  );
  assert.doesNotMatch(getClearSessionCookieHeader({ secure: requestUsesSecureTransport(req) }), /; Secure$/);
});
