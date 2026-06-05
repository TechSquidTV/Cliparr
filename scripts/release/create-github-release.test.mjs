import assert from "node:assert/strict";
import test from "node:test";
import {
  composeReleaseBody,
  parseArguments,
} from "#release/create-github-release.mjs";

const requiredArguments = [
  "--repository",
  "TechSquidTV/Cliparr",
  "--tag",
  "v0.6.1",
  "--target",
  "HEAD",
  "--previous-tag",
  "v0.6.0",
  "--name",
  "v0.6.1",
  "--image-name",
  "ghcr.io/techsquidtv/cliparr",
  "--docker-tags-file",
  "/tmp/docker-tags.txt",
];

void test("accepts an empty image digest for dry-run releases", () => {
  const arguments_ = parseArguments([
    ...requiredArguments,
    "--image-digest",
    "",
    "--dry-run",
  ]);

  assert.equal(arguments_.imageDigest, "");
  assert.equal(arguments_.dryRun, true);
});

void test("rejects release arguments with missing values", () => {
  assert.throws(
    () => parseArguments([...requiredArguments, "--image-digest"]),
    /--image-digest requires a value\./u,
  );
});

void test("omits the digest line when no image digest exists", () => {
  const body = composeReleaseBody({
    generatedBody: "## What's Changed\n\n- fix release dry runs",
    imageName: "ghcr.io/techsquidtv/cliparr",
    imageDigest: "",
    dockerTags: [
      "ghcr.io/techsquidtv/cliparr:0.6.1",
      "ghcr.io/techsquidtv/cliparr:latest",
    ],
  });

  assert.match(body, /docker pull ghcr\.io\/techsquidtv\/cliparr:0\.6\.1/u);
  assert.doesNotMatch(body, /Digest:/u);
});
