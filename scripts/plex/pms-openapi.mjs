import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PLEX_PMS_SPEC_URL = "https://developer.plex.tv/pms/";
export const PLEX_PMS_SPEC_PATH =
  "apps/server/src/providers/plex/openapi/pms.json";
export const PLEX_PMS_MANIFEST_PATH =
  "apps/server/src/providers/plex/openapi/manifest.json";
export const PLEX_PMS_GENERATED_DIR =
  "apps/server/src/providers/plex/generated";
export const HEY_API_PACKAGE_NAME = "@hey-api/openapi-ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");
function compareStrings(left, right) {
  if (left > right) {
    return 1;
  }

  if (left < right) {
    return -1;
  }

  return 0;
}

function repoPath(relativePath) {
  return path.join(repoRoot, relativePath);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findJsonObjectEnd(source, start) {
  let depth = 0;
  let isInString = false;
  let isEscaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (isInString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === '"') {
        isInString = false;
      }
      continue;
    }

    if (char === '"') {
      isInString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }

  throw new Error("Could not find the end of the Plex Redoc state object.");
}

export function extractRedocState(html) {
  const assignmentIndex = html.indexOf("const __redoc_state");
  if (assignmentIndex === -1) {
    throw new Error("Could not find Plex Redoc state in the PMS API page.");
  }

  const equalsIndex = html.indexOf("=", assignmentIndex);
  const objectStart = html.indexOf("{", equalsIndex);
  if (equalsIndex === -1 || objectStart === -1) {
    throw new Error("Plex Redoc state assignment is malformed.");
  }

  const objectEnd = findJsonObjectEnd(html, objectStart);
  return JSON.parse(html.slice(objectStart, objectEnd));
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .toSorted(compareStrings)
      .map((key) => [key, sortJsonValue(value[key])]),
  );
}

export function normalizeOpenApiSpec(spec) {
  assert.ok(isRecord(spec), "Plex PMS OpenAPI spec must be an object.");
  assert.equal(
    typeof spec.openapi,
    "string",
    "Plex PMS OpenAPI spec must include openapi.",
  );
  assert.ok(isRecord(spec.info), "Plex PMS OpenAPI spec must include info.");
  assert.equal(
    typeof spec.info.version,
    "string",
    "Plex PMS OpenAPI spec must include info.version.",
  );
  assert.ok(isRecord(spec.paths), "Plex PMS OpenAPI spec must include paths.");

  const normalized = sortJsonValue(spec);
  if (
    isRecord(normalized.info) &&
    typeof normalized.info.version === "string"
  ) {
    normalized.info.version = normalized.info.version.trim();
  }

  return normalized;
}

export function extractPmsOpenApiSpec(html) {
  const state = extractRedocState(html);
  const spec = state?.spec?.data;
  return normalizeOpenApiSpec(spec);
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function readHeyApiVersion() {
  const packageJson = JSON.parse(
    await readFile(
      repoPath("node_modules/@hey-api/openapi-ts/package.json"),
      "utf8",
    ),
  );

  if (typeof packageJson.version !== "string") {
    throw new TypeError("Could not read @hey-api/openapi-ts package version.");
  }

  return packageJson.version;
}

export async function fetchPlexPmsHtml() {
  const response = await fetch(PLEX_PMS_SPEC_URL);
  if (!response.ok) {
    throw new Error(
      `Could not fetch Plex PMS API page: ${response.status} ${response.statusText}`,
    );
  }

  return response.text();
}

function commandFailed(command, arguments_, code) {
  return new Error(
    `Command failed with exit code ${code}: ${[command, ...arguments_].join(" ")}`,
  );
}

async function run(command, arguments_) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: repoRoot,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(commandFailed(command, arguments_, code));
    });
  });
}

export async function generatePlexPmsSdk({
  inputPath = repoPath(PLEX_PMS_SPEC_PATH),
  outputDirectory = repoPath(PLEX_PMS_GENERATED_DIR),
} = {}) {
  await rm(outputDirectory, { force: true, recursive: true });
  await run("pnpm", [
    "exec",
    "openapi-ts",
    "-i",
    inputPath,
    "-o",
    outputDirectory,
    "-c",
    "@hey-api/client-fetch",
  ]);
}

export async function writePlexPmsSnapshot(html, now = new Date()) {
  const spec = extractPmsOpenApiSpec(html);
  const specJson = stableJson(spec);
  const heyApiVersion = await readHeyApiVersion();
  const manifestPath = repoPath(PLEX_PMS_MANIFEST_PATH);
  let existingManifest;

  try {
    existingManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    existingManifest = undefined;
  }

  const manifest = {
    sourceUrl: PLEX_PMS_SPEC_URL,
    upstreamVersion: spec.info.version,
    openapiVersion: spec.openapi,
    pathCount: Object.keys(spec.paths).length,
    specSha256: sha256(specJson),
    generatedBy: {
      package: HEY_API_PACKAGE_NAME,
      version: heyApiVersion,
    },
    fetchedAt:
      manifestDiffsForSpec(spec, existingManifest, heyApiVersion).length === 0
        ? existingManifest.fetchedAt
        : now.toISOString(),
  };

  await mkdir(path.dirname(repoPath(PLEX_PMS_SPEC_PATH)), { recursive: true });
  await writeFile(repoPath(PLEX_PMS_SPEC_PATH), specJson);
  await writeFile(manifestPath, stableJson(manifest));

  return manifest;
}

export function manifestDiffsForSpec(spec, manifest, heyApiVersion) {
  const specJson = stableJson(spec);
  const expected = {
    sourceUrl: PLEX_PMS_SPEC_URL,
    upstreamVersion: spec.info.version,
    openapiVersion: spec.openapi,
    pathCount: Object.keys(spec.paths).length,
    specSha256: sha256(specJson),
    generatedBy: {
      package: HEY_API_PACKAGE_NAME,
      version: heyApiVersion,
    },
  };
  const diffs = [];

  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(manifest?.[key]) !== JSON.stringify(value)) {
      diffs.push(`Manifest field ${key} is out of date.`);
    }
  }

  if (
    typeof manifest?.fetchedAt !== "string" ||
    Number.isNaN(Date.parse(manifest.fetchedAt))
  ) {
    diffs.push("Manifest field fetchedAt must be an ISO timestamp.");
  }

  return diffs;
}

export async function checkPlexPmsSnapshot() {
  const [specJson, manifestJson, heyApiVersion] = await Promise.all([
    readFile(repoPath(PLEX_PMS_SPEC_PATH), "utf8"),
    readFile(repoPath(PLEX_PMS_MANIFEST_PATH), "utf8"),
    readHeyApiVersion(),
  ]);
  const spec = normalizeOpenApiSpec(JSON.parse(specJson));
  const normalizedSpecJson = stableJson(spec);
  const diffs = manifestDiffsForSpec(
    spec,
    JSON.parse(manifestJson),
    heyApiVersion,
  );

  if (specJson !== normalizedSpecJson) {
    diffs.push("Plex PMS OpenAPI snapshot is not normalized.");
  }

  return diffs;
}

async function walkFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        return walkFiles(root, absolutePath);
      }
      if (entry.isFile()) {
        return path.relative(root, absolutePath);
      }
      return [];
    }),
  );

  return files.flat().toSorted(compareStrings);
}

export async function diffGeneratedSdk(expectedDirectory, actualDirectory) {
  const expectedFiles = await walkFiles(expectedDirectory);
  const actualFiles = await walkFiles(actualDirectory);
  const allFileSet = new Set(expectedFiles);

  for (const file of actualFiles) {
    allFileSet.add(file);
  }

  const allFiles = [...allFileSet].toSorted(compareStrings);
  const diffs = [];

  for (const file of allFiles) {
    if (!expectedFiles.includes(file)) {
      diffs.push(`Missing committed file: ${file}`);
      continue;
    }
    if (!actualFiles.includes(file)) {
      diffs.push(`Unexpected committed file: ${file}`);
      continue;
    }

    const [expected, actual] = await Promise.all([
      readFile(path.join(expectedDirectory, file)),
      readFile(path.join(actualDirectory, file)),
    ]);
    if (!expected.equals(actual)) {
      diffs.push(`Changed generated file: ${file}`);
    }
  }

  return diffs;
}

export async function checkGeneratedPlexPmsSdk() {
  const temporaryRoot =
    process.platform === "darwin" ? "/private/tmp" : os.tmpdir();
  const temporaryDirectory = await mkdtemp(
    path.join(temporaryRoot, "cliparr-plex-sdk-"),
  );

  try {
    const snapshotDiffs = await checkPlexPmsSnapshot();
    await generatePlexPmsSdk({
      inputPath: repoPath(PLEX_PMS_SPEC_PATH),
      outputDirectory: temporaryDirectory,
    });
    return [
      ...snapshotDiffs,
      ...(await diffGeneratedSdk(
        repoPath(PLEX_PMS_GENERATED_DIR),
        temporaryDirectory,
      )),
    ];
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

async function main(argv) {
  if (argv.includes("--check")) {
    const diffs = await checkGeneratedPlexPmsSdk();
    if (diffs.length > 0) {
      for (const diff of diffs) {
        process.stderr.write(`${diff}\n`);
      }
      process.exitCode = 1;
    }
    return;
  }

  const html = await fetchPlexPmsHtml();
  const manifest = await writePlexPmsSnapshot(html);
  await generatePlexPmsSdk();
  process.stdout.write(
    `Generated Plex PMS SDK from ${manifest.upstreamVersion} (${manifest.pathCount} paths).\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main(process.argv.slice(2));
}
