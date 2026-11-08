import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  nodeVersionViolations,
  readNodeConfiguration,
} from "#ci/check-node-version.mjs";

void test("source requirements, typings, workflows, and container pins are synchronized", () => {
  const files = readNodeConfiguration();
  const version = files.get(".nvmrc").trim();
  assert.match(version, /^26\.\d+\.\d+$/u);
  assert.deepEqual(nodeVersionViolations(files, version), []);
});

void test("the server compiles for the pinned Node runtime", async () => {
  const { default: configuration } = await import(
    new URL("../../apps/server/tsdown.config.ts", import.meta.url).href
  );
  assert.equal(
    configuration.target,
    `node${readFileSync(".nvmrc", "utf8").trim()}`,
  );
});

for (const file of [
  ".github/workflows/ci.yml",
  ".github/workflows/docker.yml",
]) {
  void test(`${file} reruns affected checks when the CI Node pin changes`, () => {
    assert.match(readFileSync(file, "utf8"), /^\s+- '\.nvmrc'$/mu);
  });
}
