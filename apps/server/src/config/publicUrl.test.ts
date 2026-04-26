import assert from "node:assert/strict";
import test from "node:test";
import { publicAppOriginIsPotentiallyTrustworthy, publicAppUsesSecureTransport } from "./publicUrl.js";
import { getClearSessionCookieHeader, getSessionCookieHeader } from "../session/store.js";

const originalAppUrl = process.env.APP_URL;

test.afterEach(() => {
  if (originalAppUrl === undefined) {
    delete process.env.APP_URL;
    return;
  }

  process.env.APP_URL = originalAppUrl;
});

void test("keeps HTTPS deployments secure", () => {
  process.env.APP_URL = "https://cliparr.example.com";

  assert.equal(publicAppUsesSecureTransport(), true);
  assert.equal(publicAppOriginIsPotentiallyTrustworthy(), true);
  assert.match(getSessionCookieHeader("session-123"), /; Secure$/);
  assert.match(getClearSessionCookieHeader(), /; Secure$/);
});

void test("allows localhost HTTP during local setups", () => {
  process.env.APP_URL = "http://localhost:3000";

  assert.equal(publicAppUsesSecureTransport(), false);
  assert.equal(publicAppOriginIsPotentiallyTrustworthy(), true);
  assert.doesNotMatch(getSessionCookieHeader("session-123"), /; Secure$/);
});

void test("drops secure-only policies for custom HTTP origins", () => {
  process.env.APP_URL = "http://cliparr.example.com";

  assert.equal(publicAppUsesSecureTransport(), false);
  assert.equal(publicAppOriginIsPotentiallyTrustworthy(), false);
  assert.doesNotMatch(getSessionCookieHeader("session-123"), /; Secure$/);
  assert.doesNotMatch(getClearSessionCookieHeader(), /; Secure$/);
});
