import { createDeferred } from "@/test/deferred";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeDatabase } from "@/db/database";
import {
  upsertMediaSource,
  updateMediaSource,
  type MediaSource,
} from "@/db/mediaSourcesRepository";
import { upsertProviderAccountByAccessToken } from "@/db/providerAccountsRepository";
import { createApp } from "@/app";
import { plexProvider } from "@/providers/plex/provider";
import type { CurrentlyPlayingEntry } from "@/providers/types";
import {
  createProviderSession,
  deleteProviderSession,
  getSessionCookieName,
} from "@/session/store";
import { readServerEvents } from "@cliparr/shared/server-events";
import type { PlaybackStreamEvent } from "@cliparr/shared/providers";

const TEST_APP_KEY = "media-currently-playing-test-key-with-32-chars";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

async function withTestApp<T>(callback: (baseUrl: string) => Promise<T>) {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cliparr-media-currently-playing-"),
  );
  const previousAppKey = process.env.APP_KEY;
  const previousDataDir = process.env.CLIPARR_DATA_DIR;

  process.env.APP_KEY = TEST_APP_KEY;
  process.env.CLIPARR_DATA_DIR = dataDir;

  const { app } = await createApp();
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise((resolve) => {
      server.once("listening", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    closeDatabase();
    restoreEnv("APP_KEY", previousAppKey);
    restoreEnv("CLIPARR_DATA_DIR", previousDataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

function createSource(
  providerAccountId: string,
  name: string,
  providerId = "plex",
  enabled = true,
) {
  const source = upsertMediaSource({
    providerId,
    providerAccountId,
    externalId: `${providerId}-${name.toLowerCase().replaceAll(/\s+/g, "-")}`,
    name,
    enabled,
    baseUrl: `http://${name.toLowerCase().replaceAll(/\s+/g, "-")}.example`,
  });
  assert.ok(source);
  return source;
}

function playbackEntry(
  source: MediaSource,
  viewer: { id: string; name: string },
  itemId: string,
): CurrentlyPlayingEntry {
  return {
    viewer: {
      id: viewer.id,
      providerId: source.providerId,
      name: viewer.name,
    },
    item: {
      id: itemId,
      source: {
        id: source.id,
        name: source.name,
        providerId: source.providerId,
      },
      title: `${source.name} Movie`,
      type: "movie",
      duration: 120,
      playerTitle: `${viewer.name} Player`,
      playerState: "playing",
      mediaUrl: `/api/media/${itemId}`,
    },
  };
}

void test("aggregates currently playing results across enabled sources with partial failures", async () => {
  await withTestApp(async (baseUrl) => {
    const account = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "Plex Account",
      accessToken: "user-token",
    });
    const otherAccount = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "Other Plex Account",
      accessToken: "other-token",
    });
    assert.ok(account);
    assert.ok(otherAccount);

    const alpha = createSource(account.id, "Alpha");
    const zeta = createSource(account.id, "Zeta");
    const omega = createSource(otherAccount.id, "Omega");
    createSource(account.id, "Failure");
    createSource(account.id, "Ghost", "missing-provider");
    createSource(account.id, "Unsupported");
    createSource(account.id, "Disabled", "plex", false);

    const session = createProviderSession({
      providerId: "plex",
      providerAccountId: account.id,
      userToken: "user-token",
    });

    const originalListCurrentlyPlaying =
      plexProvider.listCurrentlyPlaying.bind(plexProvider);
    const originalSupportsCurrentlyPlayingSource =
      plexProvider.supportsCurrentlyPlayingSource?.bind(plexProvider);
    const calls: string[] = [];

    plexProvider.supportsCurrentlyPlayingSource = (source) =>
      source.name !== "Unsupported";
    plexProvider.listCurrentlyPlaying = async (_session, source) => {
      calls.push(source.name);
      if (source.name === "Failure") {
        throw new Error("Source is offline");
      }

      if (source.id === alpha.id) {
        return [
          playbackEntry(
            source,
            { id: "viewer-alice", name: "Alice" },
            "alpha-item",
          ),
        ];
      }

      if (source.id === zeta.id) {
        return [
          playbackEntry(
            source,
            { id: "viewer-bob", name: "Bob" },
            "zeta-bob-item",
          ),
          playbackEntry(
            source,
            { id: "viewer-alice", name: "Alice" },
            "zeta-alice-item",
          ),
        ];
      }

      if (source.id === omega.id) {
        return [
          playbackEntry(
            source,
            { id: "viewer-carol", name: "Carol" },
            "omega-item",
          ),
        ];
      }

      return [];
    };

    try {
      const response = await fetch(`${baseUrl}/api/media/currently-playing`, {
        headers: {
          cookie: `${getSessionCookieName()}=${session.id}`,
        },
      });

      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        viewers?: Array<{
          viewer: { name: string };
          items: Array<{ source: { name: string } }>;
        }>;
        sourceErrors?: Array<{
          sourceName: string;
          providerId: string;
          message: string;
        }>;
      };

      assert.deepEqual(calls, ["Alpha", "Failure", "Omega", "Zeta"]);
      assert.deepEqual(
        body.viewers?.map((group) => group.viewer.name),
        ["Alice", "Bob", "Carol"],
      );
      assert.deepEqual(
        body.viewers?.[0]?.items.map((item) => item.source.name),
        ["Alpha", "Zeta"],
      );
      assert.deepEqual(
        body.sourceErrors
          ?.map((error) => ({
            sourceName: error.sourceName,
            providerId: error.providerId,
            message: error.message,
          }))
          .toSorted((left, right) =>
            left.sourceName.localeCompare(right.sourceName),
          ),
        [
          {
            sourceName: "Failure",
            providerId: "plex",
            message: "Source is offline",
          },
          {
            sourceName: "Ghost",
            providerId: "missing-provider",
            message: "Source provider is not registered",
          },
        ],
      );
    } finally {
      plexProvider.listCurrentlyPlaying = originalListCurrentlyPlaying;
      plexProvider.supportsCurrentlyPlayingSource =
        originalSupportsCurrentlyPlayingSource;
    }
  });
});

void test(
  "authenticated SSE delivers initial state, source disabling, and session revocation",
  { timeout: 10_000 },
  async () => {
    await withTestApp(async (baseUrl) => {
      const denied = await fetch(`${baseUrl}/api/media/live`);
      assert.equal(denied.status, 401);
      const account = upsertProviderAccountByAccessToken({
        providerId: "plex",
        label: "Test",
        accessToken: "test-token",
      });
      assert.ok(account);
      const source = createSource(account.id, "Live");
      const session = createProviderSession({
        providerId: "plex",
        providerAccountId: account.id,
        userToken: "test-token",
      });
      const originalWatch =
        plexProvider.watchCurrentlyPlaying.bind(plexProvider);
      const originalSupports =
        plexProvider.supportsCurrentlyPlayingSource?.bind(plexProvider);
      const stopped = createDeferred<void>();
      plexProvider.supportsCurrentlyPlayingSource = () => true;
      plexProvider.watchCurrentlyPlaying = async (source, observer, signal) => {
        observer.snapshot(async () => [
          playbackEntry(source, { id: "viewer", name: "Viewer" }, "live-item"),
        ]);
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              stopped.resolve();
              resolve();
            },
            { once: true },
          );
        });
      };
      const controller = new AbortController();
      try {
        const response = await fetch(`${baseUrl}/api/media/live`, {
          signal: controller.signal,
          headers: { cookie: `${getSessionCookieName()}=${session.id}` },
        });
        assert.equal(
          response.headers.get("content-type"),
          "text/event-stream; charset=utf-8",
        );
        assert.equal(response.headers.get("x-accel-buffering"), "no");
        assert.ok(response.body);
        const initial = createDeferred<void>();
        const removed = createDeferred<void>();
        const unauthorized = createDeferred<void>();
        const reading = readServerEvents(response.body, (_name, data) => {
          const event = JSON.parse(data) as PlaybackStreamEvent;
          if (event.type === "snapshot" && !event.snapshot.loading) {
            if (event.snapshot.viewers.length > 0) {
              initial.resolve();
            } else {
              removed.resolve();
            }
          }
          if (event.type === "unauthorized") {
            unauthorized.resolve();
          }
        });
        await initial.promise;
        updateMediaSource(source.id, { enabled: false });
        await removed.promise;
        await stopped.promise;
        deleteProviderSession(session.id);
        await unauthorized.promise;
        await reading;
      } finally {
        controller.abort();
        plexProvider.watchCurrentlyPlaying = originalWatch;
        plexProvider.supportsCurrentlyPlayingSource = originalSupports;
      }
    });
  },
);
