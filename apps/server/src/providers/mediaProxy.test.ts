import assert from "node:assert/strict";
import test from "node:test";
import type { Response } from "express";
import type { ProviderSessionRecord } from "../session/store.js";
import type { MediaHandle } from "./types.js";
import { proxyUpstreamMediaResponse } from "./shared/mediaProxy.js";

function createSession(): ProviderSessionRecord {
  return {
    id: "session-1",
    providerId: "plex",
    providerAccountId: "account-1",
    userToken: "user-token",
    mediaHandles: new Map(),
    createdAt: 0,
    expiresAt: Date.now() + 60_000,
  };
}

function createMediaHandle(overrides: Partial<MediaHandle> = {}): MediaHandle {
  return {
    id: "handle-1",
    providerId: "plex",
    sourceId: "source-1",
    baseUrl: "http://plex.local:32400",
    path: "/video/master.m3u8",
    token: "provider-token",
    lastAccessedAt: 0,
    ...overrides,
  };
}

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: new Map<string, string>(),
    body: "",
    ended: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string | number) {
      this.headers.set(name.toLowerCase(), String(value));
      return this;
    },
    send(body: string) {
      this.body = body;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

void test("preserves absolute HLS origins when rewriting nested playlist resources", async () => {
  const session = createSession();
  const rootHandle = createMediaHandle();
  const rootResponse = createResponseRecorder();

  await proxyUpstreamMediaResponse(
    session,
    rootHandle,
    new globalThis.Response(
      "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1280000\nhttps://cdn.example.com/hls/720p/prog_index.m3u8?token=abc\n",
      {
        status: 200,
        headers: {
          "content-type": "application/vnd.apple.mpegurl",
        },
      }
    ),
    rootResponse as unknown as Response
  );

  assert.match(rootResponse.body, /\/api\/media\//);
  assert.equal(session.mediaHandles.size, 1);

  const childPlaylistHandle = [...session.mediaHandles.values()][0];
  assert(childPlaylistHandle);
  assert.equal(childPlaylistHandle.path, "https://cdn.example.com/hls/720p/prog_index.m3u8?token=abc");
  assert.equal(childPlaylistHandle.basePath, "https://cdn.example.com/hls/720p/");

  const childResponse = createResponseRecorder();
  await proxyUpstreamMediaResponse(
    session,
    childPlaylistHandle,
    new globalThis.Response(
      "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.key?sig=1\"\nsegment0.ts\n",
      {
        status: 200,
        headers: {
          "content-type": "application/vnd.apple.mpegurl",
        },
      }
    ),
    childResponse as unknown as Response
  );

  const handlePaths = [...session.mediaHandles.values()].map((handle) => handle.path);
  assert(handlePaths.includes("https://cdn.example.com/hls/720p/key.key?sig=1"));
  assert(handlePaths.includes("https://cdn.example.com/hls/720p/segment0.ts"));
});
