import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("plan-release.mjs", import.meta.url));

function repository(context) {
  const directory = mkdtempSync(path.join(tmpdir(), "cliparr-release-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Release test",
    GIT_AUTHOR_EMAIL: "release@example.com",
    GIT_COMMITTER_NAME: "Release test",
    GIT_COMMITTER_EMAIL: "release@example.com",
    GITHUB_TOKEN: "must-not-be-used-for-planning",
    GITHUB_OUTPUT: "",
    RELEASE_PLAN_FILE: "",
  };
  const git = (...arguments_) =>
    execFileSync("git", arguments_, {
      cwd: directory,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const commit = (title) => git("commit", "--allow-empty", "-m", title);
  git("init", "-b", "main");
  commit("feat: initial release");
  git("tag", "v1.0.0");
  const run = (channel = "stable", extraEnv = {}) =>
    spawnSync(
      process.execPath,
      [script, "--channel", channel, "--target", "HEAD"],
      { cwd: directory, env: { ...env, ...extraEnv }, encoding: "utf8" },
    );
  return { directory, git, commit, run };
}

void test("plans from committed titles without fetching mutable PR metadata", (context) => {
  const repo = repository(context);
  repo.commit("fix(server): repair startup (#42)");
  const result = repo.run();
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.tag, "v1.0.1");
  assert.equal(plan.target, repo.git("rev-parse", "HEAD"));
  assert.equal(plan.previous_stable_tag, "v1.0.0");
  assert.ok(plan.docker_tags.includes("ghcr.io/techsquidtv/cliparr:latest"));
});

void test("increments RCs only for new commits and keeps stable notes cumulative", (context) => {
  const repo = repository(context);
  repo.commit("feat(frontend): new editor");
  repo.git("tag", "v1.1.0-rc.1");
  assert.match(repo.run("rc").stderr, /No new commits since v1.1.0-rc.1/u);
  const stable = JSON.parse(repo.run().stdout);
  assert.equal(stable.matches_prerelease, "true");
  assert.equal(stable.previous_tag, "v1.0.0");
  repo.commit("fix(frontend): repair preview");
  const candidate = JSON.parse(repo.run("rc").stdout);
  assert.equal(candidate.tag, "v1.1.0-rc.2");
  assert.equal(candidate.previous_tag, "v1.1.0-rc.1");
  assert.equal(candidate.changes_since_prerelease, "1");
  assert.ok(!candidate.docker_tags.some((tag) => tag.endsWith(":latest")));
});

void test("resumes the saved plan after its release tag exists", (context) => {
  const repo = repository(context);
  repo.commit("fix: startup");
  const planFile = path.join(repo.directory, "plan.json");
  const env = { RELEASE_PLAN_FILE: planFile };
  const first = repo.run("rc", env);
  assert.equal(first.status, 0, first.stderr);
  repo.git("tag", "v1.0.1-rc.1");
  const retry = repo.run("rc", env);
  assert.equal(retry.status, 0, retry.stderr);
  assert.deepEqual(JSON.parse(retry.stdout), JSON.parse(first.stdout));
  assert.equal(JSON.parse(readFileSync(planFile, "utf8")).tag, "v1.0.1-rc.1");
  assert.match(repo.run("stable", env).stderr, /does not match/u);
  repo.commit("fix: another change");
  assert.match(repo.run("rc", env).stderr, /does not match/u);
});

void test("rejects retry tag conflicts and newer stable releases", (context) => {
  const repo = repository(context);
  repo.commit("fix: startup");
  const env = { RELEASE_PLAN_FILE: path.join(repo.directory, "plan.json") };
  assert.equal(repo.run("stable", env).status, 0);
  repo.git("tag", "v1.0.1", "v1.0.0");
  assert.match(repo.run("stable", env).stderr, /points to another commit/u);
  repo.git("tag", "-d", "v1.0.1");
  repo.git("tag", "v1.1.0");
  assert.match(repo.run("stable", env).stderr, /newer stable release/u);
});

void test("refuses to resume an RC after a newer candidate has shipped", (context) => {
  const repo = repository(context);
  repo.commit("fix: startup");
  const env = { RELEASE_PLAN_FILE: path.join(repo.directory, "plan.json") };
  assert.equal(repo.run("rc", env).status, 0);
  repo.git("tag", "v1.0.1-rc.2");
  assert.match(repo.run("rc", env).stderr, /newer candidate/u);
});
