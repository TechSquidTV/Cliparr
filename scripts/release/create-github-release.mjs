#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function parseArgs(argv) {
  const args = {
    dryRun: false,
    prerelease: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run" || arg === "--prerelease") {
      args[
        arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      ] = true;
      continue;
    }

    if (
      arg === "--repository" ||
      arg === "--tag" ||
      arg === "--target" ||
      arg === "--previous-tag" ||
      arg === "--name" ||
      arg === "--image-name" ||
      arg === "--image-digest" ||
      arg === "--docker-tags-file"
    ) {
      const value = argv[index + 1];

      if (value === undefined) {
        throw new Error(`${arg} requires a value.`);
      }

      args[
        arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      ] = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument ${arg}.`);
  }

  for (const requiredArg of [
    "repository",
    "tag",
    "target",
    "previousTag",
    "name",
    "imageName",
    "dockerTagsFile",
  ]) {
    if (!args[requiredArg]) {
      throw new Error(
        `Missing --${requiredArg.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}.`,
      );
    }
  }

  return args;
}

async function githubApi(path, { method = "GET", body, token }) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "cliparr-release-automation",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(
      `GitHub API ${method} ${path} failed: ${response.status} ${await response.text()}`,
    );
  }

  return response.json();
}

function readDockerTags(filePath) {
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function composeReleaseBody({
  generatedBody,
  imageName,
  imageDigest,
  dockerTags,
}) {
  const pullTag =
    dockerTags.find(
      (tag) => !tag.endsWith(":latest") && !/:sha-[a-f0-9]+$/u.test(tag),
    ) ?? dockerTags[0];
  const dockerLines = [
    "## Docker image",
    "",
    `Published to \`${imageName}\`.`,
    "",
    "```bash",
    `docker pull ${pullTag}`,
    "```",
    "",
    "Tags:",
    ...dockerTags.map((tag) => `- \`${tag}\``),
  ];

  if (imageDigest) {
    dockerLines.push("", `Digest: \`${imageDigest}\``);
  }

  return `${generatedBody.trim()}\n\n${dockerLines.join("\n")}\n`;
}

function writeGithubOutput(outputs) {
  const outputFile = process.env.GITHUB_OUTPUT;

  if (!outputFile) {
    return;
  }

  appendFileSync(
    outputFile,
    `${Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
  );
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

  if (!token) {
    throw new Error("GITHUB_TOKEN is required to create a GitHub release.");
  }

  const dockerTags = readDockerTags(args.dockerTagsFile);
  const generatedNotes = await githubApi(
    `/repos/${args.repository}/releases/generate-notes`,
    {
      method: "POST",
      token,
      body: {
        tag_name: args.tag,
        target_commitish: args.target,
        previous_tag_name: args.previousTag,
      },
    },
  );
  const body = composeReleaseBody({
    generatedBody: generatedNotes.body,
    imageName: args.imageName,
    imageDigest: args.imageDigest,
    dockerTags,
  });

  if (args.dryRun) {
    process.stdout.write(`# ${args.name}\n\n`);
    process.stdout.write(`${body}\n`);
    writeGithubOutput({ html_url: "" });
    process.exit(0);
  }

  const release = await githubApi(`/repos/${args.repository}/releases`, {
    method: "POST",
    token,
    body: {
      tag_name: args.tag,
      target_commitish: args.target,
      name: args.name,
      body,
      draft: false,
      prerelease: args.prerelease,
      make_latest: args.prerelease ? "false" : "true",
    },
  });

  process.stdout.write(`Created release ${release.html_url}\n`);
  writeGithubOutput({ html_url: release.html_url });
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
    process.exit(1);
  }
}
