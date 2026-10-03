import assert from "node:assert/strict";
import test from "node:test";
import { findPrivacyIssues } from "#ci/privacy-check.mjs";

void test("reports fabricated private endpoints and home paths without exposing values", () => {
  const privateHost = [10, 99, 88, 77].join(".");
  const home = ["", "Users", "fixture-person", "Movies", "movie.mkv"].join("/");
  const text = `http://${privateHost}:8096\n"${home}"`;
  assert.deepEqual(findPrivacyIssues("fixture.ts", text), [
    { file: "fixture.ts", line: 1, category: "unapproved-address" },
    { file: "fixture.ts", line: 2, category: "personal-filesystem-path" },
  ]);
  const report = JSON.stringify(findPrivacyIssues("fixture.ts", text));
  assert.equal(report.includes(privateHost), false);
  assert.equal(report.includes("fixture-person"), false);
});

void test("canonicalizes disguised numeric endpoints and rejects private hostnames", () => {
  const address = [10, 99, 88, 77];
  const integer = address.reduce((value, octet) => value * 256 + octet, 0);
  for (const hostname of [
    String(integer),
    `0x${integer.toString(16)}`,
    `[::ffff:${address.join(".")}]`,
    ["fixture-device", "lan"].join("."),
    ["fixture-device", "plex", "direct"].join("."),
    "fixture-device",
    "unreviewed-service.dev",
  ]) {
    assert.ok(
      findPrivacyIssues("fixture.ts", `http://${hostname}/media`).length > 0,
    );
  }
});

void test("permits reserved fixtures, loopback, local development services, and provider API routes", () => {
  for (const value of [
    "http://plex.example.test:32400",
    "http://jellyfin:8096",
    "http://127.0.0.1:12345",
    "http://[::1]:12345",
    "192.0.2.10",
    "2001:db8::1",
    '"/Users/Me"',
    '"/Users/AuthenticateByName"',
    "http://192-0-2-10.fixture.plex.direct",
  ]) {
    assert.deepEqual(findPrivacyIssues("fixture.ts", value), []);
  }
});

void test("limits private-address exceptions to documented policy fixtures and Docker network", () => {
  const representative = [10, 0, 0, 1].join(".");
  assert.deepEqual(
    findPrivacyIssues(
      "apps/server/src/test/networkPolicyFixtures.ts",
      representative,
    ),
    [],
  );
  assert.equal(
    findPrivacyIssues("unrelated.test.ts", representative).length,
    1,
  );
  const arbitrary = [10, 99, 88, 77].join(".");
  assert.equal(
    findPrivacyIssues(
      "apps/server/src/test/networkPolicyFixtures.ts",
      arbitrary,
    ).length,
    1,
  );
  assert.equal(
    findPrivacyIssues("packages/plex/openapi/pms.json", arbitrary).length,
    1,
  );
});

void test("checks bare private hostname literals and permits reviewed public origins", () => {
  const host = ["fixture-device", "lan"].join(".");
  assert.equal(findPrivacyIssues("fixture.ts", `"${host}"`).length, 1);
  assert.deepEqual(
    findPrivacyIssues("docs.md", "https://developer.plex.tv/pms/"),
    [],
  );
});
