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
