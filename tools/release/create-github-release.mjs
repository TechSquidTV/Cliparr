#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { writeGithubOutput } from "#release/github-output.mjs";
import { pathToFileURL } from "node:url";

const booleanArgumentNames = new Set(["--dry-run", "--prerelease"]);
const valueArgumentNames = new Set([
  "--repository",
  "--tag",
  "--target",
  "--previous-tag",
  "--name",
  "--image-name",
  "--image-digest",
  "--docker-tags-file",
  "--notes-file",
]);
const requiredArguments = [
  "repository",
  "tag",
  "target",
  "previousTag",
  "name",
  "imageName",
  "dockerTagsFile",
];

function argumentNameToKey(argument) {
  return argument
    .slice(2)
    .replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function parseArguments(argv) {
  const arguments_ = {
    dryRun: false,
    prerelease: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (booleanArgumentNames.has(argument)) {
      arguments_[argumentNameToKey(argument)] = true;
      continue;
    }

    if (valueArgumentNames.has(argument)) {
      const value = argv[index + 1];

      if (value === undefined) {
        throw new Error(`${argument} requires a value.`);
      }

      arguments_[argumentNameToKey(argument)] = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument ${argument}.`);
  }

  for (const requiredArgument of requiredArguments) {
    const value = arguments_[requiredArgument];

    if (typeof value !== "string" || value.length === 0) {
      throw new Error(
        `Missing --${requiredArgument.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}.`,
      );
    }
  }

  return arguments_;
}

async function githubApi(
  path,
  { method = "GET", body, token, allowMissing = false },
) {
  const headers = {
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "cliparr-release-automation",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 404 && allowMissing) {
    return;
  }

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
  releaseNotes = "",
  generatedBody,
  imageName,
  imageDigest,
  dockerTags,
  dryRun = false,
}) {
  const pullTag =
    dockerTags.find(
      (tag) => !tag.endsWith(":latest") && !/:sha-[a-f0-9]+$/u.test(tag),
    ) ?? dockerTags[0];
  const dockerLines = [
    "## Docker image",
    "",
    `${dryRun ? "Planned image (not published)" : "Published to"} \`${imageName}\`.`,
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

  return `${[releaseNotes.trim(), generatedBody.trim(), dockerLines.join("\n")]
    .filter(Boolean)
    .join("\n\n")}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const arguments_ = parseArguments(argv);
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

  if (!token) {
    throw new Error("GITHUB_TOKEN is required to create a GitHub release.");
  }

  const dockerTags = readDockerTags(arguments_.dockerTagsFile);
  const releaseNotes = arguments_.notesFile
    ? readFileSync(arguments_.notesFile, "utf8")
    : "";
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
    releaseNotes,
    generatedBody: generatedNotes.body,
    imageName: arguments_.imageName,
    imageDigest: arguments_.imageDigest,
    dockerTags,
    dryRun: arguments_.dryRun,
  });

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `<details><summary>${arguments_.dryRun ? "Planned release notes — not published" : "Release notes"}</summary>\n\n${body}\n</details>\n`,
    );
  }

  if (arguments_.dryRun) {
    process.stdout.write(`# ${arguments_.name}\n\n`);
    process.stdout.write(`${body}\n`);
    writeGithubOutput({ html_url: "" });
    return;
  }

  const repositoryPath = `/repos/${arguments_.repository}`;
  const existing = await githubApi(
    `${repositoryPath}/releases/tags/${arguments_.tag}`,
    { token, allowMissing: true },
  );
  const taggedCommit = await githubApi(
    `${repositoryPath}/commits/${arguments_.tag}`,
    { token, allowMissing: true },
  );
  if (
    (existing && !taggedCommit) ||
    (taggedCommit && taggedCommit.sha !== arguments_.target)
  ) {
    throw new Error(`Release tag ${arguments_.tag} points to another commit.`);
  }
  const release = await githubApi(
    existing
      ? `${repositoryPath}/releases/${existing.id}`
      : `${repositoryPath}/releases`,
    {
      method: existing ? "PATCH" : "POST",
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
    },
  );

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
