import { checkGeneratedPlexPmsSdk } from "./pms-openapi.mjs";

const diffs = await checkGeneratedPlexPmsSdk();

if (diffs.length > 0) {
  for (const diff of diffs) {
    console.error(diff);
  }
  process.exitCode = 1;
}
