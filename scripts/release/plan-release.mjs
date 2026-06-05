#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import {
  bumpVersion,
  extractReleaseTitleFromCommitMessage,
  extractPullRequestNumberFromCommitMessage,
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

    if (
      argument === "--channel" ||
      argument === "--target" ||
      argument === "--image-name"
    ) {
      const value = argv[index + 1];

      if (!value) {
        throw new Error(`${argument} requires a value.`);
      }

      arguments_[
        argument
          .slice(2)
          .replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      ] = value;
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

async function githubApi(path) {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY ?? "TechSquidTV/Cliparr";

  if (!token) {
    try {
      return JSON.parse(
        execFileSync("gh", ["api", `repos/${repository}${path}`], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }),
      );
    } catch {
      return;
    }
  }

  const response = await fetch(
    `https://api.github.com/repos/${repository}${path}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "cliparr-release-planner",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `GitHub API GET ${path} failed: ${response.status} ${await response.text()}`,
    );
  }

  return response.json();
}

function getTags() {
  const output = git(["tag", "--list", "v*"]);
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

function writeGithubOutput(outputs) {
  const outputFile = process.env.GITHUB_OUTPUT;

  if (!outputFile) {
    throw new Error("GITHUB_OUTPUT is not set.");
  }

  const lines = [];

  for (const [key, value] of Object.entries(outputs)) {
    if (Array.isArray(value)) {
      lines.push(`${key}<<EOF`, ...value, "EOF");
    } else {
      lines.push(`${key}=${value}`);
    }
  }

  appendFileSync(outputFile, `${lines.join("\n")}\n`);
}

async function titleForCommitMessage(message) {
  const pullRequestNumber = extractPullRequestNumberFromCommitMessage(message);

  if (!pullRequestNumber) {
    return extractReleaseTitleFromCommitMessage(message);
  }

  const pullRequest = await githubApi(`/pulls/${pullRequestNumber}`);
  return typeof pullRequest?.title === "string"
    ? pullRequest.title
    : extractReleaseTitleFromCommitMessage(message);
}

async function planRelease(arguments_) {
  const tags = getTags();
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
  const titles = await Promise.all(
    messages.map((message) => titleForCommitMessage(message)),
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

  const previousPrereleaseTag = isPrerelease
    ? latestPrereleaseTag(tags, baseVersion, arguments_.channel)
    : undefined;
  const previousTag = previousPrereleaseTag ?? previousStableTag;
  const shortSha = getShortSha(arguments_.target);
  const dockerTags = buildDockerTags({
    imageName: arguments_.imageName,
    version,
    channel: arguments_.channel,
    shortSha,
  });

  return {
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

try {
  const arguments_ = parseArguments(process.argv.slice(2));
  const plan = await planRelease(arguments_);

  if (arguments_.githubOutput) {
    writeGithubOutput(plan);
  }

  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
