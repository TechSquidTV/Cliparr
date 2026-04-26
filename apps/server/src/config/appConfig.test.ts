import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SERVER_PORT,
  getPublicAppUrl,
  getServerPort,
  publicAppOriginIsPotentiallyTrustworthy,
  publicAppUsesSecureTransport,
} from "./appConfig.js";
import { getClearSessionCookieHeader, getSessionCookieHeader } from "../session/store.js";

const originalAppUrl = process.env.APP_URL;
const originalPort = process.env.PORT;

test.afterEach(() => {
  if (originalAppUrl === undefined) {
    delete process.env.APP_URL;
  } else {
    process.env.APP_URL = originalAppUrl;
  }

  if (originalPort === undefined) {
    delete process.env.PORT;
    return;
  }

  process.env.PORT = originalPort;
});

void test("keeps HTTPS deployments secure", () => {
  process.env.APP_URL = "https://cliparr.example.com";

  assert.equal(publicAppUsesSecureTransport(), true);
  assert.equal(publicAppOriginIsPotentiallyTrustworthy(), true);
  assert.match(getSessionCookieHeader("session-123"), /; Secure$/);
  assert.match(getClearSessionCookieHeader(), /; Secure$/);
});

void test("derives the default public app URL from the configured port", () => {
  delete process.env.APP_URL;
  process.env.PORT = "4310";

  assert.equal(getServerPort(), 4310);
  assert.equal(getPublicAppUrl().toString(), "http://localhost:4310/");
});

void test("falls back to the shared default server port", () => {
  delete process.env.APP_URL;
  delete process.env.PORT;

  assert.equal(getServerPort(), DEFAULT_SERVER_PORT);
  assert.equal(getPublicAppUrl().toString(), `http://localhost:${DEFAULT_SERVER_PORT}/`);
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
