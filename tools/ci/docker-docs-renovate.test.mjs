import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

void test("Renovate extracts both tags and digests from the deployment documentation", () => {
  const configuration = JSON.parse(readFileSync("renovate.json", "utf8"));
  const documentPath = "apps/www/src/content/docs/access-control.mdx";
  const document = readFileSync(documentPath, "utf8");
  const manager = configuration.customManagers.find((candidate) =>
    candidate.managerFilePatterns.some((pattern) =>
      new RegExp(pattern.slice(1, -1)).test(documentPath),
    ),
  );
  assert.ok(manager, "Deployment docs must be included in Renovate extraction");
  const dependencies = manager.matchStrings.flatMap((pattern) =>
    [...document.matchAll(new RegExp(pattern, "g"))].map(
      (match) => match.groups,
    ),
  );
  assert.deepEqual(
    dependencies.map((dependency) => dependency.depName),
    ["caddy", "authelia/authelia"],
  );
  for (const dependency of dependencies) {
    assert.match(dependency.currentValue, /^\d+\.\d+\.\d+$/u);
    assert.match(dependency.currentDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.ok(
      document.includes(
        `${dependency.depName}:${dependency.currentValue}@${dependency.currentDigest}`,
      ),
    );
  }
});

void test("Renovate accepts suffixed Node 26 Docker updates without widening the runtime or typings group", () => {
  const { packageRules } = JSON.parse(readFileSync("renovate.json", "utf8"));
  const grouped = packageRules.findIndex(
    (rule) => rule.groupName === "Node.js LTS",
  );
  const docker = packageRules.findLastIndex(
    (rule) =>
      rule.matchDatasources?.includes("docker") &&
      rule.matchPackageNames?.includes("node"),
  );
  assert.ok(grouped !== -1, "Node updates must retain their shared group");
  assert.ok(
    docker > grouped,
    "Docker's regex must override the shared numeric range",
  );
  assert.deepEqual(packageRules[grouped].matchPackageNames, [
    "node",
    "@types/node",
  ]);
  assert.equal(packageRules[grouped].allowedVersions, ">=26.0.0 <27.0.0");
  const override = packageRules[docker];
  assert.deepEqual(override.matchDatasources, ["docker"]);
  assert.deepEqual(override.matchPackageNames, ["node"]);
  assert.match(override.allowedVersions, /^\/.*\/$/u);
  const allowed = new RegExp(override.allowedVersions.slice(1, -1));
  for (const tag of [
    "26.13.1-trixie-slim",
    "26.14.0-trixie-slim",
    "26.13.0-trixie-slim",
  ]) {
    assert.ok(allowed.test(tag), `Node Docker update must be allowed: ${tag}`);
  }
  for (const tag of [
    "24.22.2-trixie-slim",
    "27.0.0-trixie-slim",
    "126.13.1-trixie-slim",
  ]) {
    assert.ok(!allowed.test(tag), `Other Node majors must be excluded: ${tag}`);
  }
});
