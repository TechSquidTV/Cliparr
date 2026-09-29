import {
  fetchPlexPmsHtml,
  generatePlexPmsSdk,
  writePlexPmsSnapshot,
  checkGeneratedPlexPmsSdk,
  run,
} from "#plex/pms-openapi.mjs";

const manifest = await writePlexPmsSnapshot(await fetchPlexPmsHtml());
await generatePlexPmsSdk();
const differences = await checkGeneratedPlexPmsSdk();
if (differences.length > 0) {
  throw new Error(differences.join("\n"));
}
// Matching generated inputs do not prove that their consumers passed validation.
// Always recheck, including retries after a previous update failed.
await run("pnpm", ["--filter", "@cliparr/plex", "lint:types"]);
await run("pnpm", ["--filter", "@cliparr/server", "lint:types"]);
await run("pnpm", ["--filter", "@cliparr/plex", "test"]);
await run("pnpm", ["--filter", "@cliparr/server", "test"]);
await run("pnpm", ["test:plex-sdk"]);
process.stdout.write(
  `Generated Plex contracts from PMS ${manifest.upstreamVersion} (${manifest.pathCount} upstream paths).\n`,
);
