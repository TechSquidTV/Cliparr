import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createClient } from "@cliparr/plex/pms/client";
import {
  startSelectedSubtitle,
  libraryMetadataGetSlash,
} from "@cliparr/plex/pms";
import {
  imageTranscodeUrl,
  transcodeStartUrl,
  startSelectedSubtitleUrl,
} from "@cliparr/plex/pms/urls";

// Fixture values are a reviewed independent wire oracle, not generated output.
const fixture = JSON.parse(
  await readFile(new URL("../fixtures/requests.json", import.meta.url), "utf8"),
) as {
  sidecar: { method: string; pathname: string; query: Record<string, string> };
  preview: { pathname: string };
  image: { pathname: string };
};
void test("generated sidecar operation and builder match the Plex Web wire example", async () => {
  const query = {
    path: "/library/metadata/42",
    session: "isolated-session",
    protocol: "http",
    directPlay: 1,
    hasMDE: 1,
    mediaIndex: 0,
    partIndex: 0,
    subtitles: "sidecar",
    copyts: 1,
  } as const;
  const client = createClient({
    baseUrl: "http://plex.test",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      assert.equal(request.method, fixture.sidecar.method);
      assert.equal(url.pathname, fixture.sidecar.pathname);
      assert.deepEqual(
        Object.fromEntries(url.searchParams),
        fixture.sidecar.query,
      );
      assert.equal(
        request.headers.get("x-plex-client-identifier"),
        "fixture-client",
      );
      assert.equal(
        `${url.pathname}${url.search}`,
        startSelectedSubtitleUrl({ query }),
      );
      return new Response("subtitle", {
        headers: { "content-type": "text/srt" },
      });
    },
  });
  const result = await startSelectedSubtitle({
    client,
    query,
    headers: { "X-Plex-Client-Identifier": "fixture-client" },
    parseAs: "stream",
  });
  assert.equal(result.response?.status, 200);
  await result.response?.body?.cancel();
});
void test("media builders choose concrete HLS output and encode nested artwork URLs", () => {
  const preview = new URL(
    transcodeStartUrl({
      path: { transcodeType: "video", extension: "m3u8" },
      query: { path: "/library/metadata/42", protocol: "hls" },
    }),
    "http://plex.test",
  );
  assert.equal(preview.pathname, fixture.preview.pathname);
  const nested = "/library/metadata/42/thumb?X-Plex-Token=synthetic&other=a b";
  const image = new URL(
    imageTranscodeUrl({
      query: { url: nested, width: 1920, height: 1920, upscale: 0 },
    }),
    "http://plex.test",
  );
  assert.equal(image.pathname, fixture.image.pathname);
  assert.equal(image.searchParams.get("url"), nested);
});
void test("metadata operation percent-encodes opaque IDs", async () => {
  const client = createClient({
    baseUrl: "http://plex.test",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      assert.equal(
        new URL(request.url).pathname,
        "/library/metadata/a%2Fb%20%26%3F",
      );
      return Response.json({ MediaContainer: { Metadata: [] } });
    },
  });
  await libraryMetadataGetSlash({
    client,
    path: { ids: ["a/b &?"] },
    throwOnError: true,
  });
});
