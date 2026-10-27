import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function fixture(context, options = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cliparr-seed-test-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, "bin");
  const media = path.join(directory, "media");
  const source = path.join(directory, "source");
  const calls = path.join(directory, "curl-arguments");
  mkdirSync(bin);
  writeFileSync(source, "public test movie bytes");
  const checksum = createHash("sha256")
    .update(readFileSync(source))
    .digest("hex");
  writeFileSync(
    path.join(bin, "curl"),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "$TEST_CURL_ARGUMENTS"\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = -o ]; then cp "$TEST_SOURCE" "$2"; exit; fi\n  shift\ndone\nexit 1\n`,
    { mode: 0o755 },
  );
  const movie = path.join(media, "movies/Sintel (2010)/Sintel (2010).mkv");
  if (options.existing !== undefined) {
    mkdirSync(path.dirname(movie), { recursive: true });
    writeFileSync(movie, options.existing);
  }
  const run = (environment = {}) =>
    spawnSync("sh", ["docker/seed-media.sh"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        CI: "false",
        GITHUB_ACTIONS: "false",
        MEDIA_ROOT: media,
        SINTEL_URL: "https://media.example.test/movie.mkv",
        SINTEL_SHA256: checksum,
        TEST_SOURCE: source,
        TEST_CURL_ARGUMENTS: calls,
        ...environment,
      },
    });
  return { run, movie, calls, checksum };
}

void test("verifies a download before publishing it and bounds HTTPS requests", (context) => {
  const { run, movie, calls } = fixture(context);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(movie, "utf8"), "public test movie bytes");
  const arguments_ = readFileSync(calls, "utf8");
  assert.match(arguments_, /--proto\n=https\n/);
  assert.match(arguments_, /--proto-redir\n=https\n/);
  assert.match(arguments_, /--connect-timeout\n10\n/);
  assert.match(arguments_, /--max-time\n600\n/);
});

void test("does not publish bytes with the wrong checksum and removes partial files", (context) => {
  const { run, movie } = fixture(context);
  assert.notEqual(run({ SINTEL_SHA256: "0".repeat(64) }).status, 0);
  for (const suffix of ["", ".part", ".unzip"]) {
    assert.throws(() => readFileSync(`${movie}${suffix}`), { code: "ENOENT" });
  }
});

void test("revalidates cached media without downloading or overwriting it", (context) => {
  const { run, movie, calls } = fixture(context, {
    existing: "corrupted cache",
  });
  assert.notEqual(run().status, 0);
  assert.equal(readFileSync(movie, "utf8"), "corrupted cache");
  assert.throws(() => readFileSync(calls), { code: "ENOENT" });
});

void test("reuses verified cached media without network access", (context) => {
  const { run, calls } = fixture(context, {
    existing: "public test movie bytes",
  });
  assert.equal(run().status, 0);
  assert.throws(() => readFileSync(calls), { code: "ENOENT" });
});

void test("custom sources require a SHA-256 checksum", (context) => {
  const { run, calls } = fixture(context);
  assert.notEqual(run({ SINTEL_SHA256: "" }).status, 0);
  assert.throws(() => readFileSync(calls), { code: "ENOENT" });
});

void test("CI does not download or create fixture data", (context) => {
  const { run, movie, calls } = fixture(context);
  assert.equal(run({ CI: "true" }).status, 0);
  assert.throws(() => readFileSync(movie), { code: "ENOENT" });
  assert.throws(() => readFileSync(calls), { code: "ENOENT" });
});

void test("CI rejects a corrupt cached fixture without replacing it", (context) => {
  const { run, movie, calls } = fixture(context, {
    existing: "corrupted cache",
  });
  const result = run({ CI: "true" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Media checksum mismatch/);
  assert.equal(readFileSync(movie, "utf8"), "corrupted cache");
  assert.throws(() => readFileSync(calls), { code: "ENOENT" });
});
