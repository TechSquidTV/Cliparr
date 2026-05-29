/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserFileHandle } from "./editorMedia";
import {
  createLocalSessionFromFile,
  createLocalSessionFromUrl,
  resolveFileHandleReadPermission,
  resolveLocalMediaSession,
  validateLocalMediaUrl,
} from "./localMediaRegistry";

async function withMockedLocalMediaUrl<T>(callback: () => Promise<T>) {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;

  globalThis.fetch = (async (input, init) => {
    assert.equal(input, "/api/media/local-url");
    assert.equal(init?.method, "POST");
    requestCount += 1;

    const requestBody = init?.body;
    assert.equal(typeof requestBody, "string");
    if (typeof requestBody !== "string") {
      throw new Error("Expected JSON request body.");
    }
    const body = JSON.parse(requestBody) as { url?: string };
    assert.equal(body.url, "https://example.com/video.mp4");

    return new Response(
      JSON.stringify({
        mediaUrl: `/api/media/local-url/proxy-${requestCount}`,
        hls: false,
      }),
      {
        status: 201,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void test("validates local media URLs", () => {
  assert.deepEqual(validateLocalMediaUrl(""), {
    ok: false,
    message: "Enter a media URL.",
  });
  assert.deepEqual(validateLocalMediaUrl("file:///tmp/movie.mp4"), {
    ok: false,
    message: "Media URLs must use HTTP or HTTPS.",
  });
  assert.deepEqual(
    validateLocalMediaUrl("https://example.com/master.m3u8").ok,
    true,
  );
  const result = validateLocalMediaUrl("https://example.com/master.m3u8");
  assert.equal(result.ok ? result.hls : false, true);
});

void test("creates and resolves memory-backed local file sessions", async () => {
  const file = new File(["video"], "example clip.mp4", { type: "video/mp4" });
  const session = await createLocalSessionFromFile(file);

  assert.equal(session.title, "example clip");
  assert.equal(session.local, true);
  assert.equal(session.directSource?.kind, "file");

  const resolved = await resolveLocalMediaSession(session.id);
  assert.equal(resolved.status, "ready");
  assert.equal(
    resolved.status === "ready" ? resolved.session.directSource?.kind : null,
    "file",
  );
});

void test("creates and resolves memory-backed URL sessions when IndexedDB is unavailable", async () => {
  await withMockedLocalMediaUrl(async () => {
    const result = await createLocalSessionFromUrl(
      "https://example.com/video.mp4",
    );

    assert.equal(result.status, "ready");
    assert.equal(
      result.status === "ready" ? result.session.directSource?.kind : null,
      "url",
    );
    assert.equal(
      result.status === "ready" && result.session.directSource?.kind === "url"
        ? result.session.directSource.url
        : null,
      "/api/media/local-url/proxy-1",
    );
    assert.equal(
      result.status === "ready" && result.session.directSource?.kind === "url"
        ? result.session.directSource.originalUrl
        : null,
      "https://example.com/video.mp4",
    );

    const resolved =
      result.status === "ready"
        ? await resolveLocalMediaSession(result.session.id)
        : null;
    assert.equal(resolved?.status, "ready");
    assert.equal(
      resolved?.status === "ready" ? resolved.session.directSource?.kind : null,
      "url",
    );
    assert.equal(
      resolved?.status === "ready" &&
        resolved.session.directSource?.kind === "url"
        ? resolved.session.directSource.url
        : null,
      "/api/media/local-url/proxy-2",
    );
  });
});

void test("resolves file handle permission states", async () => {
  const deniedHandle = {
    name: "denied.mp4",
    getFile: async () => new File(["video"], "denied.mp4"),
    queryPermission: async () => "denied" as const,
    requestPermission: async () => "granted" as const,
  } satisfies BrowserFileHandle;

  assert.equal(await resolveFileHandleReadPermission(deniedHandle), "denied");
  assert.equal(
    await resolveFileHandleReadPermission(deniedHandle, {
      requestPermission: true,
    }),
    "granted",
  );

  const legacyHandle = {
    name: "legacy.mp4",
    getFile: async () => new File(["video"], "legacy.mp4"),
  } satisfies BrowserFileHandle;

  assert.equal(await resolveFileHandleReadPermission(legacyHandle), "granted");
});
