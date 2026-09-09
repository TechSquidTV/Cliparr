#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { writeGithubOutput } from "#release/github-output.mjs";
import { pathToFileURL } from "node:url";
import {
  bumpVersion,
  compareSemverTags,
  extractReleaseTitleFromCommitMessage,
  formatTag,
  formatVersion,
  latestPrereleaseTag,
  latestStableTag,
  nextPrereleaseNumber,
  parseGitLogMessages,
  parseSemverTag,
  summarizeChanges,
} from "#release/conventional.mjs";

const validChannels = new Set(["stable", "rc", "beta"]);
const valueArgumentNames = new Set(["--channel", "--target", "--image-name"]);

function argumentNameToKey(argument) {
  return argument
    .slice(2)
    .replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseArguments(argv) {
  const arguments_ = {
    channel: "stable",
    target: "HEAD",
    githubOutput: false,
    imageName: process.env.IMAGE_NAME ?? "ghcr.io/techsquidtv/cliparr",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--github-output") {
      arguments_.githubOutput = true;
      continue;
    }

    if (valueArgumentNames.has(argument)) {
      const value = argv[index + 1];

      if (!value) {
        throw new Error(`${argument} requires a value.`);
      }

      arguments_[argumentNameToKey(argument)] = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument ${argument}.`);
  }

  if (!validChannels.has(arguments_.channel)) {
    throw new Error(
      `Invalid release channel ${arguments_.channel}. Use stable, rc, or beta.`,
    );
  }

  return arguments_;
}

function git(arguments_) {
  return execFileSync("git", arguments_, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function getTags(target) {
  const output = git(["tag", "--merged", target, "--list", "v*"]);
  return output ? output.split("\n").filter(Boolean) : [];
}

function getCommitMessages(fromTag, target) {
  const range = fromTag ? `${fromTag}..${target}` : target;
  const output = git(["log", "--first-parent", range, "--format=%x1e%B%x1f"]);
  return parseGitLogMessages(output);
}

function getShortSha(target) {
  return git(["rev-parse", "--short=7", target]);
}

function buildDockerTags({ imageName, version, channel, shortSha }) {
  const tags = [`${imageName}:${version}`, `${imageName}:sha-${shortSha}`];

  if (channel === "stable") {
    const [major, minor] = version.split(".");
    tags.splice(1, 0, `${imageName}:${major}.${minor}`, `${imageName}:latest`);
    return tags;
  }

  tags.splice(1, 0, `${imageName}:${channel}`);
  return tags;
}

function getCommitSha(ref) {
  // Git's peel syntax is literal, not a missing JavaScript interpolation.
  // eslint-disable-next-line unicorn/no-incorrect-template-string-interpolation
  return git(["rev-parse", `${ref}^{commit}`]);
}

export function planRelease(arguments_) {
  const target = getCommitSha(arguments_.target);
  const tags = getTags(target);
  const previousStableTag = latestStableTag(tags);

  if (!previousStableTag) {
    throw new Error(
      "No stable release tag found. Expected at least one tag like v0.1.0.",
    );
  }

  const previousStableVersion = parseSemverTag(previousStableTag);

  if (!previousStableVersion) {
    throw new Error(
      `Could not parse previous stable tag ${previousStableTag}.`,
    );
  }

  const messages = getCommitMessages(previousStableTag, arguments_.target);
  const titles = messages.map((message) =>
    extractReleaseTitleFromCommitMessage(message),
  );
  const summary = summarizeChanges(titles);

  if (summary.invalidChanges.length > 0) {
    const invalidTitles = summary.invalidChanges
      .map((change) => `- ${change.title}: ${change.error}`)
      .join("\n");
    throw new Error(
      `Release contains non-conventional PR or commit titles:\n${invalidTitles}`,
    );
  }

  if (summary.releaseType === "none") {
    throw new Error(
      "No releasable changes found since the previous stable release.",
    );
  }

  const baseVersion = formatVersion(
    bumpVersion(previousStableVersion, summary.releaseType),
  );
  const isPrerelease = arguments_.channel !== "stable";
  const version = isPrerelease
    ? `${baseVersion}-${arguments_.channel}.${nextPrereleaseNumber(tags, baseVersion, arguments_.channel)}`
    : baseVersion;
  const tag = formatTag(version);

  if (tags.includes(tag)) {
    throw new Error(`Release tag ${tag} already exists.`);
  }

  const previousPrereleaseTag = latestPrereleaseTag(
    tags,
    baseVersion,
    isPrerelease ? arguments_.channel : "rc",
  );
  const changesSincePrerelease = previousPrereleaseTag
    ? getCommitMessages(previousPrereleaseTag, target).length
    : undefined;
  if (isPrerelease && changesSincePrerelease === 0) {
    throw new Error(`No new commits since ${previousPrereleaseTag}.`);
  }
  const previousTag =
    (isPrerelease ? previousPrereleaseTag : undefined) ?? previousStableTag;
  const shortSha = getShortSha(arguments_.target);
  const dockerTags = buildDockerTags({
    imageName: arguments_.imageName,
    version,
    channel: arguments_.channel,
    shortSha,
  });

  return {
    target,
    channel: arguments_.channel,
    previous_stable_tag: previousStableTag,
    previous_prerelease_tag: previousPrereleaseTag ?? "",
    changes_since_prerelease:
      changesSincePrerelease === undefined
        ? ""
        : String(changesSincePrerelease),
    matches_prerelease: String(changesSincePrerelease === 0),
    version,
    tag,
    previous_tag: previousTag,
    release_type: summary.releaseType,
    prerelease: String(isPrerelease),
    docker_tags: dockerTags,
    release_name: tag,
    change_count: String(summary.changes.length),
    releasable_change_count: String(summary.releasableChanges.length),
  };
}

async function main(argv = process.argv.slice(2)) {
  const arguments_ = parseArguments(argv);
  const planFile = process.env.RELEASE_PLAN_FILE;
  const plan =
    planFile && existsSync(planFile)
      ? JSON.parse(readFileSync(planFile, "utf8"))
      : planRelease(arguments_);
  if (
    plan.target !== getCommitSha(arguments_.target) ||
    plan.channel !== arguments_.channel
  ) {
    throw new Error(
      "Saved release plan does not match the requested commit and channel.",
    );
  }
  const existingTags = git(["tag", "--list", "v*"]).split("\n").filter(Boolean);
  if (
    existingTags.includes(plan.tag) &&
    getCommitSha(plan.tag) !== plan.target
  ) {
    throw new Error(`Release tag ${plan.tag} points to another commit.`);
  }
  const stableTag = latestStableTag(
    existingTags.filter((tag) => tag !== plan.tag),
  );
  if (stableTag !== plan.previous_stable_tag) {
    throw new Error(
      "A newer stable release exists; refusing to resume an outdated plan.",
    );
  }
  const newerCandidate = existingTags.find((tag) => {
    const parsed = parseSemverTag(tag);
    return (
      plan.prerelease === "true" &&
      parsed?.channel === plan.channel &&
      compareSemverTags(tag, plan.tag) > 0
    );
  });
  if (newerCandidate) {
    throw new Error(
      `A newer candidate ${newerCandidate} exists; refusing to move the channel backwards.`,
    );
  }
  if (planFile) {
    writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
  }

  if (arguments_.githubOutput) {
    writeGithubOutput(plan);
  }

  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
