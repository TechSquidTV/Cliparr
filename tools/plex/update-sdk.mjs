import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  copyArtifact,
  withArtifactTransaction,
} from "#plex/artifact-transaction.mjs";
import {
  fetchPlexPmsHtml,
  generatePlexPmsSdk,
  writePlexPmsSnapshot,
  checkGeneratedPlexPmsSdk,
  PLEX_PMS_SPEC_PATH,
  PLEX_PMS_MANIFEST_PATH,
  PLEX_PMS_GENERATED_DIR,
  run,
} from "#plex/pms-openapi.mjs";

const { values } = parseArgs({ options: { "report-dir": { type: "string" } } });
const reportDirectory = values["report-dir"];
const artifacts = [
  PLEX_PMS_SPEC_PATH,
  PLEX_PMS_MANIFEST_PATH,
  PLEX_PMS_GENERATED_DIR,
];
function containsPath(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}
if (
  reportDirectory &&
  [path.dirname(PLEX_PMS_SPEC_PATH), PLEX_PMS_GENERATED_DIR].some(
    (file) =>
      containsPath(file, reportDirectory) ||
      containsPath(reportDirectory, file),
  )
) {
  throw new Error("Report directory must not overlap Plex update artifacts");
}
let stage = "fetch upstream specification";
let snapshotWritten = false;
let sdkGenerated = false;

async function clearFailureReport() {
  if (!reportDirectory) {
    return;
  }
  await mkdir(reportDirectory, { recursive: true });
  for (const name of ["report.json", "report.md", "candidate"]) {
    await rm(path.join(reportDirectory, name), {
      force: true,
      recursive: true,
    });
  }
}

async function reportFailure(error) {
  if (!reportDirectory) {
    return;
  }
  await clearFailureReport();
  if (snapshotWritten) {
    await copyArtifact(
      path.dirname(PLEX_PMS_SPEC_PATH),
      path.join(reportDirectory, "candidate/openapi"),
    );
  }
  if (sdkGenerated) {
    await copyArtifact(
      PLEX_PMS_GENERATED_DIR,
      path.join(reportDirectory, "candidate/generated"),
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  const report = {
    status: "failed",
    stage,
    snapshotWritten,
    sdkGenerated,
    error: message,
  };
  await writeFile(
    path.join(reportDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(
    path.join(reportDirectory, "report.md"),
    [
      "# Plex contract update blocked",
      "",
      `Failed stage: **${stage}**. No update was published.`,
      "",
      ...message.split("\n").map((line) => `    ${line}`),
      "",
      "Available candidate inputs and generated files are attached for review. Generation failures contain inputs only; consumer failures also contain the candidate SDK.",
      "The updater restores the original snapshot and SDK before exiting. Check the command log for any restoration errors.",
      "Resolve contract conflicts or adapt consumers, then rerun pnpm plex:sdk:update. Do not approve changed fingerprints without checking the upstream contract.",
      "",
    ].join("\n"),
  );
}

await withArtifactTransaction(
  artifacts,
  async () => {
    const html = await fetchPlexPmsHtml();
    stage = "write upstream snapshot";
    const manifest = await writePlexPmsSnapshot(html);
    snapshotWritten = true;
    stage = "generate SDK and apply corrections";
    await generatePlexPmsSdk();
    sdkGenerated = true;
    stage = "verify reproducible generation";
    const differences = await checkGeneratedPlexPmsSdk();
    if (differences.length > 0) {
      throw new Error(differences.join("\n"));
    }
    // A matching fingerprint never bypasses consumer validation, including retries.
    for (const arguments_ of [
      ["--filter", "@cliparr/plex", "lint:types"],
      ["--filter", "@cliparr/server", "lint:types"],
      ["--filter", "@cliparr/plex", "test"],
      ["--filter", "@cliparr/server", "test"],
      ["test:plex-sdk"],
    ]) {
      stage = `pnpm ${arguments_.join(" ")}`;
      await run("pnpm", arguments_);
    }
    await clearFailureReport();
    process.stdout.write(
      `Generated Plex contracts from PMS ${manifest.upstreamVersion} (${manifest.pathCount} upstream paths).\n`,
    );
  },
  reportFailure,
);
