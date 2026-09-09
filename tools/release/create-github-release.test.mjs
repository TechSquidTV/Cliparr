import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  main,
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

void test("accepts a release notes file and rejects a missing path", () => {
  const arguments_ = parseArguments([
    ...requiredArguments,
    "--notes-file",
    "tools/release/notes/v1.3.0.md",
  ]);

  assert.equal(arguments_.notesFile, "tools/release/notes/v1.3.0.md");
  assert.throws(
    () => parseArguments([...requiredArguments, "--notes-file"]),
    /--notes-file requires a value\./u,
  );
});

void test("places upgrade notes before generated changes and preserves Docker details", () => {
  const body = composeReleaseBody({
    releaseNotes: "  ## Upgrade notes\n\nRemote URLs require sign-in.\n",
    generatedBody: "## What's Changed\n\n- Improve the editor",
    imageName: "ghcr.io/techsquidtv/cliparr",
    imageDigest: "sha256:example",
    dockerTags: ["ghcr.io/techsquidtv/cliparr:1.3.0"],
  });

  assert.ok(
    body.startsWith(
      "## Upgrade notes\n\nRemote URLs require sign-in.\n\n## What's Changed",
    ),
  );
  assert.match(body, /docker pull ghcr\.io\/techsquidtv\/cliparr:1\.3\.0/u);
  assert.match(body, /Digest: `sha256:example`/u);
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

void test("dry-run notes identify the image as planned", () => {
  const body = composeReleaseBody({
    generatedBody: "Changes",
    imageName: "example/image",
    dockerTags: ["example/image:1.0.0"],
    dryRun: true,
  });
  assert.match(body, /Planned image \(not published\)/u);
  assert.doesNotMatch(body, /Published to/u);
});

function mockReleaseApi(context, { existing = false, conflict = false } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "cliparr-release-api-"));
  const tagsFile = path.join(directory, "tags.txt");
  writeFileSync(tagsFile, "example/image:1.0.0\n");
  const originalEnv = { ...process.env };
  process.env.GITHUB_TOKEN = "test-token";
  delete process.env.GITHUB_OUTPUT;
  delete process.env.GITHUB_STEP_SUMMARY;
  context.after(() => {
    process.env = originalEnv;
    rmSync(directory, { recursive: true, force: true });
  });
  const calls = [];
  context.mock.method(globalThis, "fetch", async (url, options) => {
    const pathname = new URL(url).pathname;
    calls.push({
      pathname,
      method: options.method,
      body: options.body ? JSON.parse(options.body) : undefined,
    });
    if (pathname.endsWith("/generate-notes")) {
      return Response.json({ body: "Changes" });
    }
    if (pathname.includes("/commits/")) {
      return existing || conflict
        ? Response.json({ sha: conflict ? "other" : "HEAD" })
        : new Response("Missing", { status: 404 });
    }
    if (options.method === "GET") {
      return existing
        ? Response.json({ id: 123 })
        : new Response("Missing", { status: 404 });
    }
    return Response.json({
      html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
    });
  });
  return {
    calls,
    args: [...requiredArguments.slice(0, -2), "--docker-tags-file", tagsFile],
  };
}

void test("retries update an existing release after verifying the tag target", async (context) => {
  const api = mockReleaseApi(context, { existing: true });
  await main(api.args);
  const update = api.calls.find((call) => call.method === "PATCH");
  assert.equal(update.pathname, "/repos/TechSquidTV/Cliparr/releases/123");
  assert.equal(update.body.make_latest, "true");
  assert.ok(
    !api.calls.some(
      (call) => call.method === "POST" && call.pathname.endsWith("/releases"),
    ),
  );
});

void test("release creation refuses tags belonging to another commit", async (context) => {
  const api = mockReleaseApi(context, { conflict: true });
  await assert.rejects(main(api.args), /points to another commit/u);
  assert.ok(!api.calls.some((call) => call.pathname.endsWith("/releases")));
});

void test("dry run only generates notes and never creates or updates a release", async (context) => {
  const api = mockReleaseApi(context);
  await main([...api.args, "--dry-run"]);
  assert.equal(api.calls.length, 1);
  assert.ok(api.calls[0].pathname.endsWith("/generate-notes"));
});

void test("new candidates are prereleases and never become latest", async (context) => {
  const api = mockReleaseApi(context);
  await main([...api.args, "--prerelease"]);
  const creation = api.calls.find(
    (call) => call.method === "POST" && call.pathname.endsWith("/releases"),
  );
  assert.equal(creation.body.prerelease, true);
  assert.equal(creation.body.make_latest, "false");
});
