import assert from "node:assert/strict";
import test from "node:test";

import { audioRangeResponse } from "@/lib/audioRangeResponse";
import worker from "@/worker";

const audioUrl = "https://cliparr.dev/audio/podcast.mp3";

function audioAsset(method = "GET") {
  let cancelled = false;
  const chunks = ["012", "3456", "789"];
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk === undefined) {
        controller.close();
      } else {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(method === "HEAD" ? null : body, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": "10",
        ETag: '"podcast"',
        "Last-Modified": "Wed, 04 Nov 2026 12:00:00 GMT",
        "X-Content-Type-Options": "nosniff",
      },
    }),
    cancelled: () => cancelled,
  };
}

void test("podcast seeks return the requested bytes even when ASSETS ignores Range", async () => {
  for (const [range, expected, contentRange] of [
    ["bytes=4-7", "4567", "bytes 4-7/10"],
    ["bytes=4-", "456789", "bytes 4-9/10"],
    ["bytes=-3", "789", "bytes 7-9/10"],
    ["bytes=0-0", "0", "bytes 0-0/10"],
    ["bytes=8-99", "89", "bytes 8-9/10"],
    ["bytes=-99", "0123456789", "bytes 0-9/10"],
  ] as const) {
    const asset = audioAsset();
    const response = await worker.fetch(
      new Request(audioUrl, { headers: { Range: range } }),
      { ASSETS: { fetch: async () => asset.response } },
    );
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Range"), contentRange);
    assert.equal(
      response.headers.get("Content-Length"),
      String(expected.length),
    );
    assert.equal(response.headers.get("Accept-Ranges"), "bytes");
    assert.equal(response.headers.get("Content-Type"), "audio/mpeg");
    assert.equal(response.headers.get("ETag"), '"podcast"');
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(await response.text(), expected);
  }
});

void test("unsatisfiable ranges return 416 and release the source", async () => {
  for (const range of ["bytes=10-", "bytes=-0", "bytes=8-2"]) {
    const asset = audioAsset();
    const response = audioRangeResponse(
      new Request(audioUrl, { headers: { Range: range } }),
      asset.response,
    );
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("Content-Range"), "bytes */10");
    assert.equal(response.headers.get("Content-Length"), "0");
    assert.equal(await response.text(), "");
    assert.equal(asset.cancelled(), true);
  }
});

void test("full downloads, malformed ranges, and multipart ranges remain full responses", async () => {
  for (const range of [
    undefined,
    "bytes=-",
    "bytes=foo",
    "items=1-2",
    "bytes=0-1,4-5",
  ]) {
    const response = audioRangeResponse(
      new Request(audioUrl, { headers: range ? { Range: range } : {} }),
      audioAsset().response,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Accept-Ranges"), "bytes");
    assert.equal(response.headers.get("Content-Range"), null);
    assert.equal(await response.text(), "0123456789");
  }
});

void test("If-Range requires a matching strong validator", async () => {
  for (const [validator, matches] of [
    ['"podcast"', true],
    ["Wed, 04 Nov 2026 12:00:00 GMT", true],
    ['"old-podcast"', false],
    ['W/"podcast"', false],
    ["Tue, 03 Nov 2026 12:00:00 GMT", false],
  ] as const) {
    const response = audioRangeResponse(
      new Request(audioUrl, {
        headers: { Range: "bytes=4-7", "If-Range": validator },
      }),
      audioAsset().response,
    );
    assert.equal(response.status, matches ? 206 : 200);
    assert.equal(await response.text(), matches ? "4567" : "0123456789");
  }
});

void test("HEAD advertises seeking without returning a partial body", async () => {
  const response = await worker.fetch(
    new Request(audioUrl, { method: "HEAD", headers: { Range: "bytes=4-7" } }),
    { ASSETS: { fetch: async () => audioAsset("HEAD").response } },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Length"), "10");
  assert.equal(response.headers.get("Accept-Ranges"), "bytes");
  assert.equal(response.headers.get("Content-Range"), null);
  assert.equal(await response.text(), "");
});

void test("asset errors, conditional responses, and upstream ranges pass through", async () => {
  for (const status of [404, 500, 304, 206]) {
    const asset = new Response(status === 304 ? null : "asset", { status });
    const response = await worker.fetch(
      new Request(audioUrl, { headers: { Range: "bytes=4-7" } }),
      { ASSETS: { fetch: async () => asset } },
    );
    assert.equal(response, asset);
  }
});

void test("unknown-length or encoded assets are not sliced", () => {
  for (const headers of [
    new Headers(),
    new Headers({ "Content-Length": "10", "Content-Encoding": "gzip" }),
  ]) {
    const asset = new Response("asset", { headers });
    assert.equal(
      audioRangeResponse(
        new Request(audioUrl, { headers: { Range: "bytes=4-7" } }),
        asset,
      ),
      asset,
    );
  }
});

void test("abandoning a seek cancels the upstream stream", async () => {
  const asset = audioAsset();
  const response = audioRangeResponse(
    new Request(audioUrl, { headers: { Range: "bytes=4-" } }),
    asset.response,
  );
  await response.body?.cancel();
  assert.equal(asset.cancelled(), true);
});

void test("finishing an early range releases the rest of the asset", async () => {
  const asset = audioAsset();
  const response = audioRangeResponse(
    new Request(audioUrl, { headers: { Range: "bytes=0-0" } }),
    asset.response,
  );
  assert.equal(await response.text(), "0");
  assert.equal(asset.cancelled(), true);
});
