import {
  fetchPlexPmsHtml,
  generatePlexPmsSdk,
  writePlexPmsSnapshot,
} from "#plex/pms-openapi.mjs";

const html = await fetchPlexPmsHtml();
const manifest = await writePlexPmsSnapshot(html);
await generatePlexPmsSdk();

process.stdout.write(
  `Generated Plex PMS SDK from ${manifest.upstreamVersion} (${manifest.pathCount} paths).\n`,
);
