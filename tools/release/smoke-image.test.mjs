import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../ci/smoke-image.sh", import.meta.url));
const image = "example/cliparr@sha256:index";
const manifests = [
  { digest: "sha256:amd64", platform: { os: "linux", architecture: "amd64" } },
  { digest: "sha256:arm64", platform: { os: "linux", architecture: "arm64" } },
  {
    digest: "sha256:attestation",
    platform: { os: "unknown", architecture: "unknown" },
  },
];

function smokeTest(context, entries = manifests) {
  const directory = mkdtempSync(path.join(tmpdir(), "cliparr-smoke-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const log = path.join(directory, "docker.log");
  writeFileSync(
    path.join(directory, "index.json"),
    JSON.stringify({ manifests: entries }),
  );
  writeFileSync(log, "");
  writeFileSync(
    path.join(directory, "docker"),
    `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$SMOKE_TEST_DIRECTORY/docker.log"
case "$1" in
  buildx) cat "$SMOKE_TEST_DIRECTORY/index.json" ;;
  pull|run)
    if [[ "$*" == *"@sha256:index"* ]]; then
      echo 'cannot overwrite digest sha256:index' >&2
      exit 1
    fi
    ;;
  exec) echo v24.0.0 ;;
esac
`,
    { mode: 0o755 },
  );
  writeFileSync(
    path.join(directory, "curl"),
    `#!/usr/bin/env bash
if [[ "$*" == *"/api/health"* ]]; then
  echo '{"status":"ok","database":"ok","version":"v2.0.0-rc.1"}'
else
  echo '<div id="root"></div>'
fi
`,
    { mode: 0o755 },
  );
  return {
    run: (platform, reference = image) =>
      spawnSync("bash", [script, reference, "v2.0.0-rc.1", platform], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}${path.delimiter}${process.env.PATH}`,
          SMOKE_TEST_DIRECTORY: directory,
          GITHUB_OUTPUT: "",
        },
      }),
    commands: () => readFileSync(log, "utf8").trim().split("\n"),
  };
}

void test("smokes both architectures using distinct child digests and ignores attestations", (context) => {
  const smoke = smokeTest(context);
  for (const architecture of ["amd64", "arm64"]) {
    const result = smoke.run(`linux/${architecture}`);
    assert.equal(result.status, 0, result.stderr);
    const reference = `example/cliparr@sha256:${architecture}`;
    assert.ok(
      smoke
        .commands()
        .includes(`pull --platform linux/${architecture} ${reference}`),
    );
    assert.ok(
      smoke
        .commands()
        .some(
          (command) =>
            command.startsWith("run ") && command.endsWith(reference),
        ),
    );
    assert.match(result.stdout, /app v2\.0\.0-rc\.1, Node v24\.0\.0/u);
  }
});

void test("local smoke tags do not require registry inspection or pulling", (context) => {
  const smoke = smokeTest(context);
  const result = smoke.run("linux/amd64", "cliparr:smoke");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    !smoke.commands().some((command) => /^(?:buildx|pull) /u.test(command)),
  );
});

for (const entries of [[], [manifests[1], manifests[1]]]) {
  void test(`refuses ${entries.length === 0 ? "missing" : "ambiguous"} platform manifests before running an image`, (context) => {
    const smoke = smokeTest(context, entries);
    const result = smoke.run("linux/arm64");
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Expected exactly one manifest for linux\/arm64/u,
    );
    assert.ok(
      !smoke.commands().some((command) => /^(?:pull|run) /u.test(command)),
    );
  });
}
