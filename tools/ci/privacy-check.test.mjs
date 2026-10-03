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
    ["unreviewed-service", "dev"].join("."),
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

void test("checks scheme variants and scheme-relative endpoints without exposing values", () => {
  const hostname = ["fixture-provider", "fixture-installation", "dev"].join(
    ".",
  );
  for (const prefix of ["http://", "HTTPS://", "HtTp://", "hTtPs://", "//"]) {
    for (const wrap of [
      (url) => url,
      (url) => `const endpoint = "${url}";`,
      (url) => `<video src="${url}">`,
      (url) => `[media](${url})`,
    ]) {
      const issues = findPrivacyIssues(
        "fixture.ts",
        wrap(`${prefix}${hostname}:\${port}/media`),
      );
      assert.deepEqual(issues, [
        { file: "fixture.ts", line: 1, category: "unapproved-endpoint" },
      ]);
      assert.equal(JSON.stringify(issues).includes(hostname), false);
      for (const permittedHost of ["plex.example.test", "developer.plex.tv"]) {
        assert.deepEqual(
          findPrivacyIssues(
            "fixture.ts",
            wrap(`${prefix}${permittedHost}/media`),
          ),
          [],
        );
      }
    }
  }
  for (const content of [
    "// A normal source comment",
    'const path = "/media//segment.ts";',
    'const path = "C://media/segment.ts";',
  ]) {
    assert.deepEqual(findPrivacyIssues("fixture.ts", content), []);
  }
});

void test("detects fabricated bare hostnames across public DNS suffixes", () => {
  for (const suffix of [
    "dev",
    "com",
    "net",
    "org",
    "app",
    "io",
    "tv",
    "cloud",
  ]) {
    const hostname = ["fixture-provider", "fixture-installation", suffix].join(
      ".",
    );
    const issues = findPrivacyIssues("fixture.ts", `name: "${hostname}"`);
    assert.deepEqual(issues, [
      { file: "fixture.ts", line: 1, category: "unapproved-endpoint" },
    ]);
    assert.equal(JSON.stringify(issues).includes(hostname), false);
  }
  assert.deepEqual(
    findPrivacyIssues("fixture.ts", 'name: "plex.example.test"'),
    [],
  );
  assert.deepEqual(
    findPrivacyIssues("fixture.ts", 'name: "developer.plex.tv"'),
    [],
  );
});

void test("validates literal hosts with dynamic URL components", () => {
  const privateAddress = [10, 99, 88, 77].join(".");
  const cases = [
    {
      hostname: ["fixture-device", "lan"].join("."),
      category: "private-hostname",
    },
    {
      hostname: ["fixture-device", "dev"].join("."),
      category: "unapproved-endpoint",
    },
    { hostname: privateAddress, category: "unapproved-address" },
    { hostname: `[::ffff:${privateAddress}]`, category: "unapproved-address" },
  ];
  for (const { hostname, category } of cases) {
    for (const suffix of [
      `:\${port}/media`,
      ":{port}/media",
      `/media/\${itemId}`,
      `?item=\${itemId}`,
      `#\${fragment}`,
    ]) {
      const issues = findPrivacyIssues(
        "fixture.ts",
        `http://${hostname}${suffix}`,
      );
      assert.deepEqual(issues, [{ file: "fixture.ts", line: 1, category }]);
      assert.equal(JSON.stringify(issues).includes(hostname), false);
    }
    assert.deepEqual(
      findPrivacyIssues(
        "fixture.ts",
        `http://\${user}:\${password}@${hostname}:\${port}/media`,
      ),
      [{ file: "fixture.ts", line: 1, category }],
    );
  }
});

void test("permits reserved or reviewed hosts with dynamic URL components", () => {
  const domain = `\${domain}`;
  for (const url of [
    `http://plex.example.test:\${port}/media/\${itemId}`,
    `https://developer.plex.tv/\${path}`,
    `http://[::1]:\${port}/media`,
    `http://\${host}:\${port}/media`,
    `http://plex.${domain}/media`,
    "https://{ip}.{identifier}.plex.direct:{port}",
    `\${baseUrl}/media`,
  ]) {
    assert.deepEqual(findPrivacyIssues("fixture.ts", url), []);
  }
});
