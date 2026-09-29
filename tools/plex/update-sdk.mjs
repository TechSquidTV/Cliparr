import { readFile } from "node:fs/promises";
import {
  fetchPlexPmsHtml,
  generatePlexPmsSdk,
  writePlexPmsSnapshot,
  checkGeneratedPlexPmsSdk,
  run,
  PLEX_PMS_GENERATED_DIR,
} from "#plex/pms-openapi.mjs";

const before = await readFile(
  `${PLEX_PMS_GENERATED_DIR}/inputs.json`,
  "utf8",
).catch(() => "");
const manifest = await writePlexPmsSnapshot(await fetchPlexPmsHtml());
await generatePlexPmsSdk();
const differences = await checkGeneratedPlexPmsSdk();
if (differences.length > 0) {
  throw new Error(differences.join("\n"));
}
const after = await readFile(`${PLEX_PMS_GENERATED_DIR}/inputs.json`, "utf8");
if (before !== after) {
  await run("pnpm", ["--filter", "@cliparr/plex", "lint:types"]);
  await run("pnpm", ["--filter", "@cliparr/server", "lint:types"]);
  await run("pnpm", ["--filter", "@cliparr/plex", "test"]);
  await run("pnpm", ["--filter", "@cliparr/server", "test"]);
  await run("pnpm", ["test:plex-sdk"]);
}
process.stdout.write(
  `Generated Plex contracts from PMS ${manifest.upstreamVersion} (${manifest.pathCount} upstream paths).\n`,
);
