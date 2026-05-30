import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeDatabase } from "#/db/database.js";
import {
  upsertMediaSource,
  type MediaSource,
} from "#/db/mediaSourcesRepository.js";
import { upsertProviderAccountByAccessToken } from "#/db/providerAccountsRepository.js";
import { createApp } from "#/app.js";
import { plexProvider } from "#/providers/plex/provider.js";
import type { CurrentlyPlayingEntry } from "#/providers/types.js";
import {
  createProviderSession,
  getSessionCookieName,
} from "#/session/store.js";

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
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert(address && typeof address === "object");
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve(undefined)));
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
    externalId: `${providerId}-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    enabled,
    baseUrl: `http://${name.toLowerCase().replace(/\s+/g, "-")}.example`,
  });
  assert(source);
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
    assert(account);

    const alpha = createSource(account.id, "Alpha");
    const zeta = createSource(account.id, "Zeta");
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

      assert.deepEqual(calls, ["Alpha", "Failure", "Zeta"]);
      assert.deepEqual(
        body.viewers?.map((group) => group.viewer.name),
        ["Alice", "Bob"],
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
          .sort((left, right) =>
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
