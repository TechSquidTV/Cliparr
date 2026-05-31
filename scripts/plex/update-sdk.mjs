import {
  fetchPlexPmsHtml,
  generatePlexPmsSdk,
  writePlexPmsSnapshot,
} from "./pms-openapi.mjs";

const html = await fetchPlexPmsHtml();
const manifest = await writePlexPmsSnapshot(html);
await generatePlexPmsSdk();

console.log(
  `Generated Plex PMS SDK from ${manifest.upstreamVersion} (${manifest.pathCount} paths).`,
);
