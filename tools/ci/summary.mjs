import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function cell(value) {
  return String(value ?? "unavailable")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;")
    .replaceAll("`", "&#96;")
    .replaceAll(/\r?\n/gu, "<br>");
}

const stepNames = {
  format: "Formatting",
  lint: "Lint and types",
  knip: "Unused code",
  test: "Tests (release tooling, Plex SDK, all workspaces)",
  docs: "Documentation",
  build: "Application build",
  smoke: "Local amd64 runtime smoke test",
  publish: "Multi-platform image build",
  verify_amd64: "Published amd64 digest smoke test",
  verify_arm64: "Published arm64 digest smoke test (QEMU)",
  "github-release": "GitHub release",
  aliases: "Promote Docker tags",
};

export function renderSummary({
  plan,
  steps = {},
  version,
  repository,
  sha,
  headSha,
  status,
  dryRun = false,
  phase,
  nodeVersion,
  pnpmVersion,
  imageName,
  digest,
  releaseUrl,
}) {
  const lines = [
    `## Cliparr ${phase === "plan" ? "release plan" : "validation"}`,
    "",
  ];
  if (phase !== "plan") {
    let outcome = status ?? "unavailable";
    if (dryRun) {
      outcome = `Dry run — not published (${outcome})`;
    } else if (steps.publish && steps.publish.outcome === "success") {
      outcome =
        steps.aliases?.outcome === "success"
          ? "Published"
          : "Partially published — inspect stages below; rerun this workflow to resume";
    }
    lines.push(`**${cell(outcome)}**`, "");
  }
  lines.push("| Version / source | Value |", "| --- | --- |");
  const row = (name, value) => lines.push(`| ${name} | ${cell(value)} |`);
  row("App version", plan?.tag ?? version);
  if (phase === "plan") {
    row(
      "Mode",
      dryRun
        ? "Dry run — not published"
        : "Publication requested after validation",
    );
  }
  if (repository && sha) {
    lines.push(
      `| Tested commit | [${cell(sha.slice(0, 7))}](https://github.com/${repository}/commit/${sha}) |`,
    );
  }
  if (headSha && headSha !== sha) {
    row("PR head (tested commit above is the merge)", headSha);
  }
  if (plan) {
    row("Channel", plan.channel);
    row("Previous stable", plan.previous_stable_tag);
    row(
      "Version bump",
      `${plan.release_type}; ${plan.releasable_change_count} release-impacting changes of ${plan.change_count}`,
    );
    row("Previous candidate", plan.previous_prerelease_tag || "none");
    row(
      "Commits since candidate",
      plan.changes_since_prerelease || "none available",
    );
    row(
      "Matches candidate commit",
      plan.previous_prerelease_tag ? plan.matches_prerelease : "no candidate",
    );
    row("Release notes start", plan.previous_tag);
    row("Docker tags (planned)", plan.docker_tags.join("\n"));
  }
  row(
    "Runner Node / pnpm",
    `${nodeVersion ?? "unavailable"} / ${pnpmVersion ?? "unavailable"}`,
  );
  for (const id of ["smoke", "verify_amd64", "verify_arm64"]) {
    if (steps[id]?.outputs?.runtime_node) {
      row(`${stepNames[id]} — Node`, steps[id].outputs.runtime_node);
    }
  }
  if (digest) {
    row(dryRun ? "Build digest (not published)" : "Registry digest", digest);
  }
  if (releaseUrl) {
    lines.push("", `[GitHub release](${releaseUrl})`);
  }
  if (!dryRun && digest && imageName) {
    lines.push("", "```bash", `docker pull ${imageName}@${digest}`, "```");
  }
  if (phase !== "plan") {
    lines.push(
      "",
      "| Validation / publication stage | Result |",
      "| --- | --- |",
    );
    for (const [id, name] of Object.entries(stepNames)) {
      if (steps[id]) {
        const label =
          dryRun && id === "github-release" ? "Release notes preview" : name;
        lines.push(`| ${label} | ${cell(steps[id].outcome)} |`);
      }
    }
    if (steps.publish && !steps.verify_arm64) {
      lines.push("", "ARM64: build only; no runtime smoke test in this job.");
    }
  }
  return `${lines.join("\n")}\n`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const planFile = process.env.RELEASE_PLAN_FILE;
  const summary = renderSummary({
    plan:
      planFile && existsSync(planFile)
        ? JSON.parse(readFileSync(planFile, "utf8"))
        : undefined,
    steps: JSON.parse(process.env.SUMMARY_STEPS ?? "{}"),
    phase: process.env.SUMMARY_PHASE,
    version: process.env.CLIPARR_VERSION,
    repository: process.env.GITHUB_REPOSITORY,
    sha: process.env.GITHUB_SHA,
    headSha: process.env.PR_HEAD_SHA,
    status: process.env.JOB_STATUS,
    dryRun: process.env.DRY_RUN === "true",
    nodeVersion: process.version,
    pnpmVersion: execFileSync("pnpm", ["--version"], {
      encoding: "utf8",
    }).trim(),
    imageName: process.env.IMAGE_NAME,
    digest: process.env.IMAGE_DIGEST,
    releaseUrl: process.env.RELEASE_URL,
  });
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
