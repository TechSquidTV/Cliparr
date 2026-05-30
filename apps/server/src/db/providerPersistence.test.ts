import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeDatabase, initializeDatabase } from "./database.js";
import {
  getMediaSourceByProviderExternalId,
  listMediaSources,
  updateMediaSource,
} from "./mediaSourcesRepository.js";
import { persistProviderAuth } from "./providerPersistence.js";
import { PLEX_BASE_URL_MODE_MANUAL } from "../providers/plex/connectionState.js";

const TEST_APP_KEY = "provider-persistence-test-key-with-32-characters";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function withDatabase<T>(callback: () => T) {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cliparr-provider-persistence-"),
  );
  const previousAppKey = process.env.APP_KEY;
  const previousDataDir = process.env.CLIPARR_DATA_DIR;

  process.env.APP_KEY = TEST_APP_KEY;
  process.env.CLIPARR_DATA_DIR = dataDir;

  try {
    initializeDatabase();
    return callback();
  } finally {
    closeDatabase();
    restoreEnv("APP_KEY", previousAppKey);
    restoreEnv("CLIPARR_DATA_DIR", previousDataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

void test("preserves manual Plex source URLs and disables stale resources", () => {
  withDatabase(() => {
    const provider = {
      id: "plex",
      name: "Plex",
      auth: "pin" as const,
    };

    const account = persistProviderAuth({
      provider,
      userToken: "user-token",
      resources: [
        {
          id: "kept-server",
          name: "Kept Server",
          accessToken: "server-token-before",
          connections: [
            {
              id: "auto-connection",
              uri: "http://auto-before.example:32400",
              local: true,
              relay: false,
            },
          ],
        },
        {
          id: "stale-server",
          name: "Stale Server",
          accessToken: "stale-token",
          connections: [
            {
              id: "stale-connection",
              uri: "http://stale.example:32400",
              local: true,
              relay: false,
            },
          ],
        },
      ],
    });

    const keptBefore = getMediaSourceByProviderExternalId(
      "plex",
      account.id,
      "kept-server",
    );
    assert(keptBefore);
    updateMediaSource(keptBefore.id, {
      baseUrl: "http://manual.example:32400",
      connection: {
        ...keptBefore.connection,
        baseUrlMode: PLEX_BASE_URL_MODE_MANUAL,
      },
    });

    persistProviderAuth({
      provider,
      userToken: "user-token",
      resources: [
        {
          id: "kept-server",
          name: "Kept Server Renamed",
          accessToken: "server-token-after",
          connections: [
            {
              id: "auto-connection-after",
              uri: "http://auto-after.example:32400",
              local: false,
              relay: false,
            },
          ],
        },
      ],
    });

    const keptAfter = getMediaSourceByProviderExternalId(
      "plex",
      account.id,
      "kept-server",
    );
    const staleAfter = getMediaSourceByProviderExternalId(
      "plex",
      account.id,
      "stale-server",
    );
    assert(keptAfter);
    assert(staleAfter);

    assert.equal(keptAfter.name, "Kept Server Renamed");
    assert.equal(keptAfter.enabled, true);
    assert.equal(keptAfter.baseUrl, "http://manual.example:32400");
    assert.equal(keptAfter.connection.baseUrlMode, PLEX_BASE_URL_MODE_MANUAL);
    assert.equal(keptAfter.credentials.accessToken, "server-token-after");
    assert.equal(staleAfter.enabled, false);
    assert.equal(listMediaSources({ providerAccountId: account.id }).length, 2);
  });
});
