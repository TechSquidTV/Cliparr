import assert from "node:assert/strict";
import test from "node:test";

import { nodeVersionViolations } from "#ci/check-node-version.mjs";

const version = "26.13.0";
const image = `node:${version}-trixie-slim@sha256:${"a".repeat(64)}`;
const runtimeImage = `node:${version}-trixie-slim@sha256:${"b".repeat(64)}`;

function fixture() {
  return new Map([
    [".nvmrc", `${version}\n`],
    [
      "package.json",
      JSON.stringify({
        engines: { node: `^${version}` },
        devDependencies: { "@types/node": "catalog:" },
      }),
    ],
    [
      "apps/server/package.json",
      JSON.stringify({ devDependencies: { "@types/node": "catalog:" } }),
    ],
    ["pnpm-workspace.yaml", 'catalog:\n  "@types/node": ^26.6.6\n'],
    [
      "docker/Dockerfile",
      `FROM --platform=$BUILDPLATFORM ${image} AS toolchain
FROM toolchain AS development
FROM toolchain AS manifests
FROM manifests AS server-build
FROM manifests AS frontend-build
FROM manifests AS capture-frontend-build
FROM manifests AS capture
FROM ${runtimeImage} AS production
`,
    ],
    [
      ".github/workflows/ci.yml",
      "jobs:\n  lint-build:\n    steps:\n      - uses: actions/setup-node@v7\n        with:\n          node-version-file: .nvmrc\n",
    ],
  ]);
}

void test("accepts synchronized runtimes, caret engines, and independently versioned Node typings", () => {
  assert.deepEqual(nodeVersionViolations(fixture(), version), []);
});

for (const value of [undefined, "26", "lts/*", "v26.13.0", "26.13.0-rc.1"]) {
  void test(`rejects missing or non-exact .nvmrc: ${value}`, () => {
    const files = fixture();
    if (value === undefined) {
      files.delete(".nvmrc");
    } else {
      files.set(".nvmrc", value);
    }
    assert.match(nodeVersionViolations(files, version).join("\n"), /\.nvmrc:/u);
  });
}

for (const runtimeVersion of [version, "26.13.1", "26.14.0", "26.100.0"]) {
  void test(`accepts compatible stable local Node: ${runtimeVersion}`, () => {
    assert.deepEqual(nodeVersionViolations(fixture(), runtimeVersion), []);
  });
}

for (const runtimeVersion of [
  "24.22.2",
  "26.12.1",
  "26.9.99",
  "27.0.0",
  "26.14.0-rc.1",
  "invalid",
]) {
  void test(`rejects local Node outside the supported range: ${runtimeVersion}`, () => {
    assert.match(
      nodeVersionViolations(fixture(), runtimeVersion).join("\n"),
      /use a stable Node 26 version satisfying \^26\.13\.0/u,
    );
  });
}

void test("CI accepts the exact pin and rejects both older and compatible newer runtimes", () => {
  assert.deepEqual(
    nodeVersionViolations(fixture(), version, { exactRuntime: true }),
    [],
  );
  for (const runtimeVersion of ["26.12.1", "26.13.1", "26.14.0", "27.0.0"]) {
    assert.match(
      nodeVersionViolations(fixture(), runtimeVersion, {
        exactRuntime: true,
      }).join("\n"),
      /CI requires Node 26\.13\.0/u,
    );
  }
});

void test("compatible local Node does not excuse Docker configuration drift", () => {
  const files = fixture();
  files.set(
    "docker/Dockerfile",
    files.get("docker/Dockerfile").replace(version, "26.13.1"),
  );
  assert.match(
    nodeVersionViolations(files, "26.13.1").join("\n"),
    /toolchain must use node:26\.13\.0-trixie-slim/u,
  );
});

for (const range of [">=24.16.0", "^26.12.0", ">=26.13.0", "26.13.0"]) {
  void test(`rejects an unsynchronized engine range: ${range}`, () => {
    const files = fixture();
    files.set("package.json", JSON.stringify({ engines: { node: range } }));
    assert.match(
      nodeVersionViolations(files, version).join("\n"),
      /package\.json: engines.node must be \^26\.13\.0/u,
    );
  });
}

for (const [target, pin, replacement] of [
  ["toolchain", image, image.replace(version, "26.12.1")],
  ["toolchain", image, image.split("@")[0]],
  ["toolchain", image, image.replace("a".repeat(64), "short")],
  [
    "production",
    runtimeImage,
    runtimeImage.replace("trixie-slim", "bookworm-slim"),
  ],
  ["production", runtimeImage, runtimeImage.replace(version, "24.22.2")],
  ["production", runtimeImage, runtimeImage.replace("-trixie-slim", "-trixie")],
  ["production", runtimeImage, runtimeImage.split("@")[0]],
  ["production", runtimeImage, runtimeImage.replace("b".repeat(64), "short")],
]) {
  void test(`rejects ${target} image drift: ${replacement}`, () => {
    const files = fixture();
    files.set(
      "docker/Dockerfile",
      files.get("docker/Dockerfile").replace(pin, replacement),
    );
    assert.ok(
      nodeVersionViolations(files, version).some((error) =>
        error.includes(`${target} must use`),
      ),
    );
  });
}

void test("rejects forcing production onto the build platform", () => {
  const files = fixture();
  files.set(
    "docker/Dockerfile",
    files
      .get("docker/Dockerfile")
      .replace(
        `FROM ${runtimeImage}`,
        `FROM --platform=$BUILDPLATFORM ${runtimeImage}`,
      ),
  );
  assert.match(
    nodeVersionViolations(files, version).join("\n"),
    /production must retain its target platform/u,
  );
});

void test("rejects a slim target that bypasses the toolchain through an intermediate stage", () => {
  const files = fixture();
  files.set(
    "docker/Dockerfile",
    files
      .get("docker/Dockerfile")
      .replace("FROM toolchain AS manifests", `FROM ${image} AS manifests`),
  );
  assert.match(
    nodeVersionViolations(files, version).join("\n"),
    /capture must inherit from toolchain/u,
  );
});

for (const input of [
  "node-version: 26",
  "node-version-file: .node-version",
  "node-version-file: .nvmrc\n          node-version: 26",
]) {
  void test(`rejects setup-node configuration drift: ${input}`, () => {
    const files = fixture();
    files.set(
      ".github/workflows/ci.yml",
      files
        .get(".github/workflows/ci.yml")
        .replace("node-version-file: .nvmrc", input),
    );
    assert.match(
      nodeVersionViolations(files, version).join("\n"),
      /ci.yml: setup-node must use/u,
    );
  });
}

void test("checks pinned setup-node actions inside reusable local actions", () => {
  const files = fixture();
  files.set(
    ".github/actions/setup/action.yaml",
    `runs:\n  using: composite\n  steps:\n    - uses: actions/setup-node@${"b".repeat(40)}\n      with:\n        node-version: 24\n`,
  );
  assert.match(
    nodeVersionViolations(files, version).join("\n"),
    /action.yaml: setup-node/u,
  );
});

void test("rejects missing and malformed catalog typings and direct workspace versions", () => {
  for (const contents of [
    "catalog: {}",
    'catalog:\n  "@types/node": ^24.19.1',
    'catalog:\n  "@types/node": latest',
  ]) {
    const files = fixture();
    files.set("pnpm-workspace.yaml", contents);
    assert.match(
      nodeVersionViolations(files, version).join("\n"),
      /catalog @types\/node/u,
    );
  }
  const files = fixture();
  files.set(
    "apps/server/package.json",
    JSON.stringify({ devDependencies: { "@types/node": "^26.6.6" } }),
  );
  assert.match(
    nodeVersionViolations(files, version).join("\n"),
    /apps\/server\/package.json.*catalog:/u,
  );
});

void test("reports invalid YAML/JSON and missing configuration with file context", () => {
  const files = fixture();
  files.set(".github/workflows/ci.yml", "jobs: [");
  files.set("apps/server/package.json", "{");
  files.delete("pnpm-workspace.yaml");
  const errors = nodeVersionViolations(files, version).join("\n");
  assert.match(errors, /ci.yml: configuration could not be parsed/u);
  assert.match(
    errors,
    /apps\/server\/package.json: configuration could not be parsed/u,
  );
  assert.match(
    errors,
    /pnpm-workspace.yaml: required configuration is missing/u,
  );
});
