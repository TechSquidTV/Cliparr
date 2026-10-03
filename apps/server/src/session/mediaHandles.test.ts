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

  context.mock.method(Date, "now", () => session.expiresAt + 60_000);
  assert.equal(pruneSessionMediaHandles(session), 3);
  assert.equal(session.mediaHandles.size, 0);
});

void test("gates prune walks for 60 seconds per handle map", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 1000 });
  const session: ProviderSessionRecord = {
    id: "prune-session",
    providerId: "jellyfin",
    providerAccountId: "account-1",
    userToken: "token",
    mediaHandles: new Map(),
    createdAt: 1000,
    expiresAt: 100_000,
  };
  createProviderMediaHandle(
    session,
    {
      providerId: "jellyfin",
      sourceId: "source-1",
      baseUrl: "http://jellyfin.local",
      token: "token",
    },
    "/segment.ts",
  );
  const entries = context.mock.method(session.mediaHandles, "entries");
  assert.equal(pruneSessionMediaHandles(session, 1000), 0);
  context.mock.timers.tick(59_999);
  // Records mapped again from SQLite still share the same map and prune gate.
  assert.equal(pruneSessionMediaHandles({ ...session }, 1000), 0);
  assert.equal(entries.mock.callCount(), 1);
  assert.equal(session.mediaHandles.size, 1);
  context.mock.timers.tick(1);
  assert.equal(pruneSessionMediaHandles(session, 1000), 1);
  assert.equal(entries.mock.callCount(), 2);
});

void test("prunes above the size threshold even within the prune window", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 1000 });
  const session: ProviderSessionRecord = {
    id: "large-session",
    providerId: "jellyfin",
    providerAccountId: "account-1",
    userToken: "token",
    mediaHandles: new Map(),
    createdAt: 1000,
    expiresAt: 100_000,
  };
  assert.equal(pruneSessionMediaHandles(session, 1000), 0);
  for (let index = 0; index < 2001; index += 1) {
    createProviderMediaHandle(
      session,
      {
        providerId: "jellyfin",
        sourceId: "source-1",
        baseUrl: "http://jellyfin.local",
        token: "token",
      },
      `/segment-${index}.ts`,
    );
  }
  context.mock.timers.tick(1001);
  assert.equal(pruneSessionMediaHandles(session, 1000), 2001);
  assert.equal(session.mediaHandles.size, 0);
});
