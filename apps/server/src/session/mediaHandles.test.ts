import assert from "node:assert/strict";
import test from "node:test";
import { createProviderMediaHandle } from "@/providers/shared/mediaProxy";
import {
  pruneSessionMediaHandles,
  type ProviderSessionRecord,
} from "@/session/store";

void test("retains editor playlists and segments for the provider session lifetime", (context) => {
  const createdAt = Date.now();
  const session: ProviderSessionRecord = {
    id: "editor-session",
    providerId: "jellyfin",
    providerAccountId: "account-1",
    userToken: "token",
    mediaHandles: new Map(),
    createdAt,
    expiresAt: createdAt + 12 * 60 * 60 * 1000,
  };
  const provider = {
    providerId: "jellyfin",
    sourceId: "source-1",
    baseUrl: "http://192.168.1.50:8096",
    token: "token",
  };
  const paths = ["/master.m3u8", "/video.m3u8", "/segment-1.ts"];
  context.mock.method(Date, "now", () => createdAt);
  const urls = paths.map((path) =>
    createProviderMediaHandle(session, provider, path),
  );

  for (const now of [createdAt + 16 * 60 * 1000, session.expiresAt - 1]) {
    context.mock.method(Date, "now", () => now);
    assert.equal(pruneSessionMediaHandles(session), 0);
    assert.deepEqual(
      [...session.mediaHandles.keys()].map((id) => `/api/media/${id}`),
      urls,
    );
  }

  context.mock.method(Date, "now", () => session.expiresAt + 1);
  assert.equal(pruneSessionMediaHandles(session), 3);
  assert.equal(session.mediaHandles.size, 0);
});
