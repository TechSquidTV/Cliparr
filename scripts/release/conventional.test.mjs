import assert from "node:assert/strict";
import test from "node:test";
import {
  bumpVersion,
  extractReleaseTitleFromCommitMessage,
  extractPullRequestNumberFromCommitMessage,
  formatVersion,
  latestPrereleaseTag,
  maxReleaseType,
  nextPrereleaseNumber,
  parseConventionalTitle,
  releaseTypeForChange,
} from "#release/conventional.mjs";

void test("classifies conventional PR titles into release levels", () => {
  assert.equal(
    releaseTypeForChange(
      parseConventionalTitle("fix: keep HLS seeking stable"),
    ),
    "patch",
  );
  assert.equal(
    releaseTypeForChange(
      parseConventionalTitle("perf: reduce preview startup work"),
    ),
    "patch",
  );
  assert.equal(
    releaseTypeForChange(
      parseConventionalTitle("security: tighten URL validation"),
    ),
    "patch",
  );
  assert.equal(
    releaseTypeForChange(
      parseConventionalTitle("build(deps): bump npm dependencies"),
    ),
    "patch",
  );
  assert.equal(
    releaseTypeForChange(parseConventionalTitle("feat: add provider presets")),
    "minor",
  );
  assert.equal(
    releaseTypeForChange(
      parseConventionalTitle("feat!: replace export settings format"),
    ),
    "major",
  );
  assert.equal(
    releaseTypeForChange(parseConventionalTitle("docs: clarify Docker setup")),
    "none",
  );
});

void test("chooses the highest release level in a change set", () => {
  const changes = [
    parseConventionalTitle("docs: update setup copy"),
    parseConventionalTitle("fix: preserve source metadata"),
    parseConventionalTitle("feat: add release changelog"),
  ];

  assert.equal(maxReleaseType(changes), "minor");
});

void test("rejects unknown conventional commit types", () => {
  const change = parseConventionalTitle("release: publish next version");

  assert.equal(change.valid, false);
});

void test("accepts non-release maintenance commit types", () => {
  const change = parseConventionalTitle("ci: automate releases");

  assert.equal(change.valid, true);
  assert.equal(releaseTypeForChange(change), "none");
});

void test("bumps semantic versions by release level", () => {
  const version = { major: 1, minor: 2, patch: 3 };

  assert.equal(formatVersion(bumpVersion(version, "patch")), "1.2.4");
  assert.equal(formatVersion(bumpVersion(version, "minor")), "1.3.0");
  assert.equal(formatVersion(bumpVersion(version, "major")), "2.0.0");
});

void test("increments prerelease numbers for an existing base version and channel", () => {
  const tags = ["v0.7.0-rc.1", "v0.7.0-rc.2", "v0.7.0-beta.1", "v0.6.0"];

  assert.equal(nextPrereleaseNumber(tags, "0.7.0", "rc"), 3);
  assert.equal(nextPrereleaseNumber(tags, "0.7.0", "beta"), 2);
  assert.equal(latestPrereleaseTag(tags, "0.7.0", "rc"), "v0.7.0-rc.2");
});

void test("extracts pull request titles from merge commits", () => {
  const message = `Merge pull request #82 from TechSquidTV/codex/cliparr-www-site

feat: add cliparr.dev website`;

  assert.equal(
    extractReleaseTitleFromCommitMessage(message),
    "feat: add cliparr.dev website",
  );
  assert.equal(extractPullRequestNumberFromCommitMessage(message), 82);
});

void test("extracts pull request numbers from squash commits", () => {
  const message = `[codex] Prepare Cloudflare Worker deploy (#83)`;

  assert.equal(extractReleaseTitleFromCommitMessage(message), message);
  assert.equal(extractPullRequestNumberFromCommitMessage(message), 83);
});
