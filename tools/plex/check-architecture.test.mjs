import assert from "node:assert/strict";
import test from "node:test";
import { architectureViolations } from "#plex/check-architecture.mjs";

const consumer = "apps/server/src/providers/plex/example.ts";
for (const source of [
  "fetch(url)",
  "globalThis.fetch(url)",
  'globalThis["fetch"](url)',
  "const request = globalThis.fetch; request(url)",
  "const { fetch: request } = globalThis; request(url)",
  // eslint-disable-next-line no-template-curly-in-string -- source code fixture
  "const url = `/video/:/transcode/universal/start.m3u8?path=${id}`",
  'import { fetchMediaHandleRequest } from "@/providers/shared/mediaProxy"',
  'import { fetchWithPinnedDns as send } from "@/providers/shared/pinnedFetch"',
  'import { createClient } from "@cliparr/plex/pms/client"',
  'const url = "/library" + "/parts/" + id',
  'export { createClient } from "@cliparr/plex/pms/client"',
  'const transport = await import("@/providers/shared/pinnedFetch")',
  'import * as proxy from "@/providers/shared/mediaProxy"',
  'import axios from "axios"',
  "interface PlexMetadata { title: string }",
]) {
  void test(`rejects Plex bypass: ${source}`, () => {
    assert.ok(architectureViolations(consumer, source).length > 0);
  });
}
void test("permits generated calls and returned resource references", () => {
  assert.deepEqual(
    architectureViolations(
      consumer,
      'import { imageTranscodeUrl } from "@cliparr/plex/pms/urls"; const path = imageTranscodeUrl({ query: { url: item.thumb } }); const resource = new URL(item.key, baseUrl);',
    ),
    [],
  );
});
void test("rejects endpoints outside the provider folder", () => {
  assert.ok(
    architectureViolations(
      "tools/bootstrap.ts",
      'fetch(base + "/library/sections")',
    ).length > 0,
  );
});

void test("rejects Plex shell networking with dynamic URLs", () => {
  assert.ok(
    architectureViolations(
      "docker/bootstrap-plex.sh",
      'curl "$PLEX_BASE_URL/$endpoint"',
    ).length > 0,
  );
});
