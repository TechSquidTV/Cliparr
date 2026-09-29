import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

void test("updater retries consumer validation even after inputs were regenerated", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "plex-update-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const script = path.join(directory, "update-sdk.mjs");
  await copyFile(new URL("update-sdk.mjs", import.meta.url), script);
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      type: "module",
      imports: { "#plex/pms-openapi.mjs": "./pipeline.mjs" },
    }),
  );
  // Isolate network/generation/child commands while running the actual updater.
  // Generation persists its fingerprint even when a later consumer check fails.
  await writeFile(
    path.join(directory, "pipeline.mjs"),
    String.raw`import { appendFile, readFile, writeFile } from "node:fs/promises";
export const PLEX_PMS_GENERATED_DIR = ".";
export const fetchPlexPmsHtml = async () => "";
export const writePlexPmsSnapshot = async () => ({ upstreamVersion: "test", pathCount: 207 });
export const generatePlexPmsSdk = async () => writeFile("inputs.json", "new-inputs");
export const checkGeneratedPlexPmsSdk = async () => [];
export async function run(command, args) {
  await appendFile("checks.jsonl", JSON.stringify([command, ...args]) + "\n");
  if (args.includes("@cliparr/server") && args.includes("lint:types") &&
      await readFile("consumer-state", "utf8") === "broken") {
    throw new Error("Consumer is incompatible with regenerated contracts");
  }
}
`,
  );
  await writeFile(path.join(directory, "inputs.json"), "old-inputs");
  await writeFile(path.join(directory, "consumer-state"), "broken");
  const run = () =>
    spawnSync(process.execPath, [script], {
      cwd: directory,
      encoding: "utf8",
      timeout: 10_000,
    });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = run();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Consumer is incompatible/);
    assert.doesNotMatch(result.stdout, /Generated Plex contracts/);
    assert.equal(
      await readFile(path.join(directory, "inputs.json"), "utf8"),
      "new-inputs",
    );
  }

  await writeFile(path.join(directory, "consumer-state"), "fixed");
  await writeFile(path.join(directory, "checks.jsonl"), "");
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Generated Plex contracts/);
  const checksLog = await readFile(
    path.join(directory, "checks.jsonl"),
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
