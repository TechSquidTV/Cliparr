import { checkGeneratedPlexPmsSdk } from "#plex/pms-openapi.mjs";

const diffs = await checkGeneratedPlexPmsSdk();

if (diffs.length > 0) {
  for (const diff of diffs) {
    process.stderr.write(`${diff}\n`);
  }
  process.exitCode = 1;
}
