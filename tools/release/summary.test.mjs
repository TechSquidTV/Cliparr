import assert from "node:assert/strict";
import test from "node:test";
import { renderSummary } from "#ci/summary.mjs";

void test("dry runs never report successful builds as published", () => {
  const summary = renderSummary({
    dryRun: true,
    status: "success",
    steps: { publish: { outcome: "success" } },
    imageName: "example/image",
    digest: "sha256:abc",
  });
  assert.match(summary, /Dry run — not published/u);
  assert.match(summary, /ARM64: build only/u);
  assert.doesNotMatch(summary, /docker pull/u);
});

void test("reports partial publication and preserves failed and skipped outcomes", () => {
  const summary = renderSummary({
    steps: {
      publish: { outcome: "success" },
      verify_arm64: { outcome: "failure" },
      aliases: { outcome: "skipped" },
    },
  });
  assert.match(summary, /Partially published/u);
  assert.match(summary, /QEMU\) \| failure/u);
  assert.match(summary, /Promote Docker tags \| skipped/u);
});

void test("escapes version text and identifies the tested PR merge commit", () => {
  const summary = renderSummary({
    version: "branch|<test>@abc",
    repository: "owner/repo",
    sha: "abcdefg",
    headSha: "1234567",
    status: "success",
  });
  assert.match(summary, /branch&#124;&lt;test&gt;@abc/u);
  assert.match(summary, /commit\/abcdefg/u);
  assert.match(summary, /PR head \(tested commit above is the merge\)/u);
});
