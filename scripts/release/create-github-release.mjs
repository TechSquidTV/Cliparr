#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function parseArguments(argv) {
  const arguments_ = {
    dryRun: false,
    prerelease: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--dry-run" || argument === "--prerelease") {
      arguments_[
        argument
          .slice(2)
          .replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      ] = true;
      continue;
    }

    if (
      argument === "--repository" ||
      argument === "--tag" ||
      argument === "--target" ||
      argument === "--previous-tag" ||
      argument === "--name" ||
      argument === "--image-name" ||
      argument === "--image-digest" ||
      argument === "--docker-tags-file"
    ) {
      const value = argv[index + 1];

      if (value === undefined) {
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

  for (const requiredArgument of [
    "repository",
    "tag",
    "target",
    "previousTag",
    "name",
    "imageName",
    "dockerTagsFile",
  ]) {
    if (!arguments_[requiredArgument]) {
      throw new Error(
        `Missing --${requiredArgument.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}.`,
      );
    }
  }

  return arguments_;
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
  const arguments_ = parseArguments(argv);
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

  if (!token) {
    throw new Error("GITHUB_TOKEN is required to create a GitHub release.");
  }

  const dockerTags = readDockerTags(arguments_.dockerTagsFile);
  const generatedNotes = await githubApi(
    `/repos/${arguments_.repository}/releases/generate-notes`,
    {
      method: "POST",
      token,
      body: {
        tag_name: arguments_.tag,
        target_commitish: arguments_.target,
        previous_tag_name: arguments_.previousTag,
      },
    },
  );
  const body = composeReleaseBody({
    generatedBody: generatedNotes.body,
    imageName: arguments_.imageName,
    imageDigest: arguments_.imageDigest,
    dockerTags,
  });

  if (arguments_.dryRun) {
    process.stdout.write(`# ${arguments_.name}\n\n`);
    process.stdout.write(`${body}\n`);
    writeGithubOutput({ html_url: "" });
    process.exit(0);
  }

  const release = await githubApi(`/repos/${arguments_.repository}/releases`, {
    method: "POST",
    token,
    body: {
      tag_name: arguments_.tag,
      target_commitish: arguments_.target,
      name: arguments_.name,
      body,
      draft: false,
      prerelease: arguments_.prerelease,
      make_latest: arguments_.prerelease ? "false" : "true",
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
