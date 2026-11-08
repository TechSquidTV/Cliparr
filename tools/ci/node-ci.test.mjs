import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import test from "node:test";

void test("CI pins an exact Node 26 release and all setup-node steps read it", () => {
  assert.match(readFileSync(".nvmrc", "utf8").trim(), /^26\.\d+\.\d+$/u);
  let setups = 0;
  for (const file of globSync(".github/workflows/*.{yml,yaml}")) {
    const steps = readFileSync(file, "utf8").split(/(?=^ +-[ \t])/mu);
    for (const step of steps) {
      if (!step.includes("uses: actions/setup-node@")) {
        continue;
      }
      setups += 1;
      assert.match(step, /^\s+node-version-file: \.nvmrc\s*$/mu, file);
      assert.doesNotMatch(step, /^\s+node-version:/mu, file);
    }
  }
  assert.ok(setups > 0, "workflow setup-node steps must be discovered");
});

for (const file of [
  ".github/workflows/ci.yml",
  ".github/workflows/docker.yml",
]) {
  void test(`${file} reruns affected checks when the CI Node pin changes`, () => {
    assert.match(readFileSync(file, "utf8"), /^\s+- '\.nvmrc'$/mu);
  });
}

void test("Renovate limits the CI Node update rule to the nvm manager", () => {
  const { packageRules } = JSON.parse(readFileSync("renovate.json", "utf8"));
  const rules = packageRules.filter((rule) => rule.groupName === "CI Node.js");
  assert.equal(rules.length, 1);
  const [rule] = rules;
  assert.deepEqual(rule.matchManagers, ["nvm"]);
  assert.deepEqual(rule.matchPackageNames, ["node"]);
  assert.equal(rule.allowedVersions, ">=26.0.0 <27.0.0");
  assert.equal(rule.semanticCommitType, "ci");
});

void test("the CI pin preserves Node 24 source support, compilation, and container runtimes", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(manifest.engines.node, ">=24.16.0");
  assert.match(
    readFileSync("apps/server/tsdown.config.ts", "utf8"),
    /target: "node24"/u,
  );
  const dockerfile = readFileSync("docker/Dockerfile", "utf8");
  for (const stage of ["toolchain", "production"]) {
    const from = dockerfile
      .split("\n")
      .find((line) => line.endsWith(` AS ${stage}`));
    assert.match(from ?? "", /^FROM (?:--platform=\S+ )?node:24\./u);
  }
});
