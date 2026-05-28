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
} from "./conventional.mjs";

const validChannels = new Set(["stable", "rc", "beta"]);

function parseArgs(argv) {
  const args = {
    channel: "stable",
    target: "HEAD",
    githubOutput: false,
    imageName: process.env.IMAGE_NAME ?? "ghcr.io/techsquidtv/cliparr",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--github-output") {
      args.githubOutput = true;
      continue;
    }

    if (arg === "--channel" || arg === "--target" || arg === "--image-name") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error(`${arg} requires a value.`);
      }

      args[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument ${arg}.`);
  }

  if (!validChannels.has(args.channel)) {
    throw new Error(`Invalid release channel ${args.channel}. Use stable, rc, or beta.`);
  }

  return args;
}

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function githubApi(path) {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY ?? "TechSquidTV/Cliparr";

  if (!token) {
    try {
      return JSON.parse(execFileSync("gh", ["api", `repos/${repository}${path}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }));
    } catch {
      return undefined;
    }
  }

  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "User-Agent": "cliparr-release-planner",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API GET ${path} failed: ${response.status} ${await response.text()}`);
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
  const tags = [
    `${imageName}:${version}`,
    `${imageName}:sha-${shortSha}`,
  ];

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
      lines.push(`${key}<<EOF`);
      lines.push(...value);
      lines.push("EOF");
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

async function planRelease(args) {
  const tags = getTags();
  const previousStableTag = latestStableTag(tags);

  if (!previousStableTag) {
    throw new Error("No stable release tag found. Expected at least one tag like v0.1.0.");
  }

  const previousStableVersion = parseSemverTag(previousStableTag);

  if (!previousStableVersion) {
    throw new Error(`Could not parse previous stable tag ${previousStableTag}.`);
  }

  const messages = getCommitMessages(previousStableTag, args.target);
  const titles = await Promise.all(messages.map(titleForCommitMessage));
  const summary = summarizeChanges(titles);

  if (summary.invalidChanges.length > 0) {
    const invalidTitles = summary.invalidChanges
      .map((change) => `- ${change.title}: ${change.error}`)
      .join("\n");
    throw new Error(`Release contains non-conventional PR or commit titles:\n${invalidTitles}`);
  }

  if (summary.releaseType === "none") {
    throw new Error("No releasable changes found since the previous stable release.");
  }

  const baseVersion = formatVersion(bumpVersion(previousStableVersion, summary.releaseType));
  const isPrerelease = args.channel !== "stable";
  const version = isPrerelease
    ? `${baseVersion}-${args.channel}.${nextPrereleaseNumber(tags, baseVersion, args.channel)}`
    : baseVersion;
  const tag = formatTag(version);

  if (tags.includes(tag)) {
    throw new Error(`Release tag ${tag} already exists.`);
  }

  const previousPrereleaseTag = isPrerelease
    ? latestPrereleaseTag(tags, baseVersion, args.channel)
    : undefined;
  const previousTag = previousPrereleaseTag ?? previousStableTag;
  const shortSha = getShortSha(args.target);
  const dockerTags = buildDockerTags({
    imageName: args.imageName,
    version,
    channel: args.channel,
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
  const args = parseArgs(process.argv.slice(2));
  const plan = await planRelease(args);

  if (args.githubOutput) {
    writeGithubOutput(plan);
  }

  console.log(JSON.stringify(plan, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
