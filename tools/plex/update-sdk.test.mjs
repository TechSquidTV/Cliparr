import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  access,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function updaterFixture(context) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "plex-update-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  for (const file of ["update-sdk.mjs", "artifact-transaction.mjs"]) {
    await copyFile(new URL(file, import.meta.url), path.join(directory, file));
  }
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      type: "module",
      imports: {
        "#plex/pms-openapi.mjs": "./pipeline.mjs",
        "#plex/artifact-transaction.mjs": "./artifact-transaction.mjs",
      },
    }),
  );
  // Mock network, generation and child commands; run the actual updater and
  // filesystem transaction so failed candidates must restore exact local bytes.
  await writeFile(
    path.join(directory, "pipeline.mjs"),
    String.raw`
import { appendFile, mkdir, readFile, writeFile, rm } from "node:fs/promises";
export const PLEX_PMS_SPEC_PATH = "openapi/pms.json";
export const PLEX_PMS_MANIFEST_PATH = "openapi/manifest.json";
export const PLEX_PMS_GENERATED_DIR = "generated";
const state = () => readFile("failure", "utf8");
export async function fetchPlexPmsHtml() {
  if (await state() === "fetch") throw new Error("fetch failed");
  return "upstream";
}
export async function writePlexPmsSnapshot() {
  await writeFile(PLEX_PMS_SPEC_PATH, "new spec");
  await writeFile(PLEX_PMS_MANIFEST_PATH, "new manifest");
  return { upstreamVersion: "test", pathCount: 207 };
}
export async function generatePlexPmsSdk() {
  if (await state() === "generation") throw new Error("generation failed");
  await rm(PLEX_PMS_GENERATED_DIR, { recursive: true });
  await mkdir(PLEX_PMS_GENERATED_DIR);
  await writeFile("generated/inputs.json", "new inputs");
}
export const checkGeneratedPlexPmsSdk = async () => await state() === "reproducibility" ? ["reproducibility failed"] : [];
export async function run(command, args) {
  await appendFile("checks.jsonl", JSON.stringify([command, ...args]) + "\n");
  if (args.includes("@cliparr/server") &&
      (args.includes("lint:types") && await state() === "consumer" ||
       args.includes("test") && await state() === "tests")) {
    throw new Error("Consumer validation failed");
  }
}
`,
  );
  await mkdir(path.join(directory, "openapi"));
  await mkdir(path.join(directory, "generated"));
  const originals = {
    "openapi/pms.json": "local spec",
    "openapi/manifest.json": "local manifest",
    "generated/inputs.json": "local inputs",
    "generated/local-edit.txt": "uncommitted SDK edit",
  };
  for (const [file, text] of Object.entries(originals)) {
    await writeFile(path.join(directory, file), text);
  }
  return {
    directory,
    originals,
    run: (report = "report") =>
      spawnSync(
        process.execPath,
        [path.join(directory, "update-sdk.mjs"), "--report-dir", report],
        { cwd: directory, encoding: "utf8", timeout: 10_000 },
      ),
    setFailure: (failure) =>
      writeFile(path.join(directory, "failure"), failure),
  };
}

void test("updater restores local artifacts and reports candidates at every failure stage", async (context) => {
  const fixture = await updaterFixture(context);
  for (const failure of [
    "fetch",
    "generation",
    "reproducibility",
    "consumer",
    "tests",
  ]) {
    await fixture.setFailure(failure);
    const result = fixture.run(`report-${failure}`);
    assert.equal(result.status, 1, result.stderr);
    assert.doesNotMatch(result.stdout, /Generated Plex contracts/);
    for (const [file, original] of Object.entries(fixture.originals)) {
      assert.equal(
        await readFile(path.join(fixture.directory, file), "utf8"),
        original,
        failure,
      );
    }
    const reportDirectory = path.join(fixture.directory, `report-${failure}`);
    const report = JSON.parse(
      await readFile(path.join(reportDirectory, "report.json"), "utf8"),
    );
    assert.equal(report.status, "failed");
    assert.equal(report.snapshotWritten, failure !== "fetch");
    assert.equal(
      report.sdkGenerated,
      !["fetch", "generation"].includes(failure),
    );
    if (report.snapshotWritten) {
      assert.equal(
        await readFile(
          path.join(reportDirectory, "candidate/openapi/pms.json"),
          "utf8",
        ),
        "new spec",
      );
    }
    if (report.sdkGenerated) {
      assert.equal(
        await readFile(
          path.join(reportDirectory, "candidate/generated/inputs.json"),
          "utf8",
        ),
        "new inputs",
      );
    } else {
      await assert.rejects(
        access(path.join(reportDirectory, "candidate/generated")),
      );
    }
  }
});

void test("updater retries all consumer checks and retains the new artifacts only on success", async (context) => {
  const fixture = await updaterFixture(context);
  await fixture.setFailure("consumer");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.equal(fixture.run().status, 1);
    assert.equal(
      await readFile(
        path.join(fixture.directory, "generated/inputs.json"),
        "utf8",
      ),
      "local inputs",
    );
  }
  await fixture.setFailure("none");
  await writeFile(path.join(fixture.directory, "checks.jsonl"), "");
  const result = fixture.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Generated Plex contracts/);
  await assert.rejects(
    access(path.join(fixture.directory, "report/report.json")),
  );
  await assert.rejects(
    access(path.join(fixture.directory, "report/candidate")),
  );
  assert.equal(
    await readFile(path.join(fixture.directory, "openapi/pms.json"), "utf8"),
    "new spec",
  );
  assert.equal(
    await readFile(
      path.join(fixture.directory, "openapi/manifest.json"),
      "utf8",
    ),
    "new manifest",
  );
  assert.equal(
    await readFile(
      path.join(fixture.directory, "generated/inputs.json"),
      "utf8",
    ),
    "new inputs",
  );
  const checksLog = await readFile(
    path.join(fixture.directory, "checks.jsonl"),
    "utf8",
  );
  const checks = checksLog
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(checks, [
    ["pnpm", "--filter", "@cliparr/plex", "lint:types"],
    ["pnpm", "--filter", "@cliparr/server", "lint:types"],
    ["pnpm", "--filter", "@cliparr/plex", "test"],
    ["pnpm", "--filter", "@cliparr/server", "test"],
    ["pnpm", "test:plex-sdk"],
  ]);
});

void test("failure reporting cannot prevent restoration", async (context) => {
  const fixture = await updaterFixture(context);
  await fixture.setFailure("consumer");
  await writeFile(path.join(fixture.directory, "not-a-directory"), "occupied");
  const result = fixture.run("not-a-directory");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /original artifacts restored/);
  for (const [file, original] of Object.entries(fixture.originals)) {
    assert.equal(
      await readFile(path.join(fixture.directory, file), "utf8"),
      original,
    );
  }
});

void test("report directories cannot overwrite the source contracts", async (context) => {
  const fixture = await updaterFixture(context);
  await fixture.setFailure("none");
  for (const report of [".", "openapi", "openapi/report", "generated/report"]) {
    const result = fixture.run(report);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must not overlap/);
  }
  for (const [file, original] of Object.entries(fixture.originals)) {
    assert.equal(
      await readFile(path.join(fixture.directory, file), "utf8"),
      original,
    );
  }
});
