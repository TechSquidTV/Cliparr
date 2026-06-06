import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeDatabase, initializeDatabase } from "@/db/database";
import {
  getMediaSourceByProviderExternalId,
  listMediaSources,
  updateMediaSource,
  upsertMediaSource,
} from "@/db/mediaSourcesRepository";
import { cleanupDuplicatePlexSources } from "@/db/plexSourceDeduplication";
import { persistProviderAuth } from "@/db/providerPersistence";
import {
  getProviderAccount,
  upsertProviderAccountByAccessToken,
} from "@/db/providerAccountsRepository";
import {
  createRememberedProviderSession,
  getRememberedProviderSession,
} from "@/db/rememberedProviderSessionsRepository";
import { createProviderSession, getProviderSession } from "@/session/store";
import { PLEX_BASE_URL_MODE_MANUAL } from "@/providers/plex/connectionState";

const TEST_APP_KEY = "provider-persistence-test-key-with-32-characters";
const plexProvider = {
  id: "plex",
  name: "Plex",
  auth: "pin" as const,
};
const jellyfinProvider = {
  id: "jellyfin",
  name: "Jellyfin",
  auth: "credentials" as const,
};

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
    const account = persistProviderAuth({
      provider: plexProvider,
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
    assert.ok(keptBefore);
    updateMediaSource(keptBefore.id, {
      baseUrl: "http://manual.example:32400",
      connection: {
        ...keptBefore.connection,
        baseUrlMode: PLEX_BASE_URL_MODE_MANUAL,
      },
    });

    persistProviderAuth({
      provider: plexProvider,
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
    assert.ok(keptAfter);
    assert.ok(staleAfter);

    assert.equal(keptAfter.name, "Kept Server Renamed");
    assert.equal(keptAfter.enabled, true);
    assert.equal(keptAfter.baseUrl, "http://manual.example:32400");
    assert.equal(keptAfter.connection.baseUrlMode, PLEX_BASE_URL_MODE_MANUAL);
    assert.equal(keptAfter.credentials.accessToken, "server-token-after");
    assert.equal(staleAfter.enabled, false);
    assert.equal(listMediaSources({ providerAccountId: account.id }).length, 2);
  });
});

void test("deduplicates Plex sources across logins with different user tokens", () => {
  withDatabase(() => {
    const firstAccount = persistProviderAuth({
      provider: plexProvider,
      userToken: "desktop-user-token",
      resources: [
        {
          id: "plex-server-1",
          name: "Living Room Plex",
          accessToken: "desktop-server-token",
          connections: [
            {
              id: "desktop-connection",
              uri: "https://plex.example:32400",
              local: false,
              relay: false,
            },
          ],
        },
      ],
    });

    const secondAccount = persistProviderAuth({
      provider: plexProvider,
      userToken: "phone-user-token",
      resources: [
        {
          id: "plex-server-1",
          name: "Living Room Plex",
          accessToken: "phone-server-token",
          connections: [
            {
              id: "phone-connection",
              uri: "https://plex.example:32400",
              local: false,
              relay: false,
            },
          ],
        },
      ],
    });

    const sources = listMediaSources({ providerId: "plex" });
    assert.equal(sources.length, 1);
    assert.equal(secondAccount.id, firstAccount.id);
    assert.equal(sources[0]?.credentials.accessToken, "phone-server-token");
    assert.equal(
      getProviderAccount(firstAccount.id)?.accessToken,
      "phone-user-token",
    );
  });
});

void test("keeps unique Plex servers when deduplicating a repeated login", () => {
  withDatabase(() => {
    const firstAccount = persistProviderAuth({
      provider: plexProvider,
      userToken: "desktop-user-token",
      resources: [
        {
          id: "plex-server-a",
          name: "Server A",
          accessToken: "desktop-server-a-token",
          connections: [
            {
              id: "desktop-a-connection",
              uri: "https://server-a.example:32400",
              local: false,
              relay: false,
            },
          ],
        },
      ],
    });

    const secondAccount = persistProviderAuth({
      provider: plexProvider,
      userToken: "phone-user-token",
      resources: [
        {
          id: "plex-server-a",
          name: "Server A",
          accessToken: "phone-server-a-token",
          connections: [
            {
              id: "phone-a-connection",
              uri: "https://server-a.example:32400",
              local: false,
              relay: false,
            },
          ],
        },
        {
          id: "plex-server-b",
          name: "Server B",
          accessToken: "phone-server-b-token",
          connections: [
            {
              id: "phone-b-connection",
              uri: "https://server-b.example:32400",
              local: false,
              relay: false,
            },
          ],
        },
      ],
    });

    const sources = listMediaSources({ providerId: "plex" }).toSorted(
      (left, right) =>
        (left.externalId ?? "").localeCompare(right.externalId ?? ""),
    );

    assert.equal(secondAccount.id, firstAccount.id);
    assert.deepEqual(
      sources.map((source) => source.externalId),
      ["plex-server-a", "plex-server-b"],
    );
    assert.deepEqual(
      sources.map((source) => source.providerAccountId),
      [firstAccount.id, firstAccount.id],
    );
    assert.equal(sources[0]?.credentials.accessToken, "phone-server-a-token");
    assert.equal(sources[1]?.credentials.accessToken, "phone-server-b-token");
    assert.deepEqual(
      getProviderAccount(firstAccount.id)?.metadata.resourceIds,
      ["plex-server-a", "plex-server-b"],
    );
  });
});

void test("does not merge different Plex server IDs that share a URL", () => {
  withDatabase(() => {
    const firstAccount = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "Plex Account",
      accessToken: "first-user-token",
    });
    const secondAccount = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "Plex Account",
      accessToken: "second-user-token",
    });
    assert.ok(firstAccount);
    assert.ok(secondAccount);

    upsertMediaSource({
      providerId: "plex",
      providerAccountId: firstAccount.id,
      externalId: "plex-server-a",
      name: "Server A",
      baseUrl: "https://plex.example:32400",
      connection: {
        connections: [
          {
            id: "a-connection",
            uri: "https://plex.example:32400",
            local: false,
            relay: false,
          },
        ],
      },
    });
    upsertMediaSource({
      providerId: "plex",
      providerAccountId: secondAccount.id,
      externalId: "plex-server-b",
      name: "Server B",
      baseUrl: "https://plex.example:32400",
      connection: {
        connections: [
          {
            id: "b-connection",
            uri: "https://plex.example:32400",
            local: false,
            relay: false,
          },
        ],
      },
    });

    const cleanup = cleanupDuplicatePlexSources();
    const sources = listMediaSources({ providerId: "plex" }).toSorted(
      (left, right) =>
        (left.externalId ?? "").localeCompare(right.externalId ?? ""),
    );

    assert.equal(cleanup.duplicateSourceCount, 0);
    assert.deepEqual(
      sources.map((source) => source.externalId),
      ["plex-server-a", "plex-server-b"],
    );
    assert.ok(getProviderAccount(firstAccount.id));
    assert.ok(getProviderAccount(secondAccount.id));
  });
});

void test("merges Plex account components bridged by a repeated login", () => {
  withDatabase(() => {
    const firstAccount = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "Plex Account",
      accessToken: "first-user-token",
    });
    const secondAccount = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "Plex Account",
      accessToken: "second-user-token",
    });
    const phoneAccount = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "Plex Account",
      accessToken: "phone-user-token",
    });
    assert.ok(firstAccount);
    assert.ok(secondAccount);
    assert.ok(phoneAccount);

    upsertMediaSource({
      providerId: "plex",
      providerAccountId: firstAccount.id,
      externalId: "plex-server-a",
      name: "Server A",
      baseUrl: "https://server-a.example:32400",
      credentials: {
        accessToken: "first-server-a-token",
      },
    });
    upsertMediaSource({
      providerId: "plex",
      providerAccountId: secondAccount.id,
      externalId: "plex-server-c",
      name: "Server C",
      baseUrl: "https://server-c.example:32400",
      credentials: {
        accessToken: "second-server-c-token",
      },
    });
    upsertMediaSource({
      providerId: "plex",
      providerAccountId: phoneAccount.id,
      externalId: "plex-server-a",
      name: "Server A",
      baseUrl: "https://server-a.example:32400",
      credentials: {
        accessToken: "phone-server-a-token",
      },
    });
    upsertMediaSource({
      providerId: "plex",
      providerAccountId: phoneAccount.id,
      externalId: "plex-server-c",
      name: "Server C",
      baseUrl: "https://server-c.example:32400",
      credentials: {
        accessToken: "phone-server-c-token",
      },
    });

    const cleanup = cleanupDuplicatePlexSources({
      preferredAccountId: phoneAccount.id,
    });
    const sources = listMediaSources({ providerId: "plex" }).toSorted(
      (left, right) =>
        (left.externalId ?? "").localeCompare(right.externalId ?? ""),
    );

    assert.equal(cleanup.providerAccountId, firstAccount.id);
    assert.equal(cleanup.duplicateSourceCount, 2);
    assert.equal(cleanup.deletedAccountCount, 2);
    assert.deepEqual(
      sources.map((source) => source.externalId),
      ["plex-server-a", "plex-server-c"],
    );
    assert.deepEqual(
      sources.map((source) => source.providerAccountId),
      [firstAccount.id, firstAccount.id],
    );
    assert.equal(sources[0]?.credentials.accessToken, "phone-server-a-token");
    assert.equal(sources[1]?.credentials.accessToken, "phone-server-c-token");
    assert.equal(
      getProviderAccount(firstAccount.id)?.accessToken,
      "phone-user-token",
    );
    assert.equal(getProviderAccount(secondAccount.id), undefined);
    assert.equal(getProviderAccount(phoneAccount.id), undefined);
  });
});

void test("disables stale Plex sources on the canonical account after dedupe", () => {
  withDatabase(() => {
    const firstAccount = persistProviderAuth({
      provider: plexProvider,
      userToken: "desktop-user-token",
      resources: [
        {
          id: "plex-server-a",
          name: "Server A",
          accessToken: "desktop-server-a-token",
          connections: [
            {
              id: "desktop-a-connection",
              uri: "https://server-a.example:32400",
              local: false,
              relay: false,
            },
          ],
        },
        {
          id: "plex-server-stale",
          name: "Stale Server",
          accessToken: "desktop-stale-token",
          connections: [
            {
              id: "desktop-stale-connection",
              uri: "https://stale.example:32400",
              local: false,
              relay: false,
            },
          ],
        },
      ],
    });

    const secondAccount = persistProviderAuth({
      provider: plexProvider,
      userToken: "phone-user-token",
      resources: [
        {
          id: "plex-server-a",
          name: "Server A",
          accessToken: "phone-server-a-token",
          connections: [
            {
              id: "phone-a-connection",
              uri: "https://server-a.example:32400",
              local: false,
              relay: false,
            },
          ],
        },
      ],
    });

    const keptSource = getMediaSourceByProviderExternalId(
      "plex",
      firstAccount.id,
      "plex-server-a",
    );
    const staleSource = getMediaSourceByProviderExternalId(
      "plex",
      firstAccount.id,
      "plex-server-stale",
    );

    assert.equal(secondAccount.id, firstAccount.id);
    assert.equal(keptSource?.enabled, true);
    assert.equal(keptSource?.credentials.accessToken, "phone-server-a-token");
    assert.equal(staleSource?.enabled, false);
    assert.deepEqual(
      getProviderAccount(firstAccount.id)?.metadata.resourceIds,
      ["plex-server-a"],
    );
  });
});

void test("cleans existing duplicate Plex sources and preserves manual URL mode", () => {
  withDatabase(() => {
    const canonicalAccount = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "Plex Account",
      accessToken: "desktop-user-token",
    });
    const duplicateAccount = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "Plex Account",
      accessToken: "phone-user-token",
    });
    assert.ok(canonicalAccount);
    assert.ok(duplicateAccount);

    const canonicalSource = upsertMediaSource({
      providerId: "plex",
      providerAccountId: canonicalAccount.id,
      externalId: "plex-server-1",
      name: "plex.rackserver.dev",
      baseUrl: "https://manual.example:32400",
      connection: {
        baseUrlMode: PLEX_BASE_URL_MODE_MANUAL,
        connections: [
          {
            id: "manual-connection",
            uri: "https://auto-before.example:32400",
            local: false,
            relay: false,
          },
        ],
        selectedConnectionId: "manual-connection",
      },
      credentials: {
        accessToken: "desktop-server-token",
      },
      metadata: {
        product: "Plex Media Server",
        platform: "Linux",
        owned: true,
        provides: ["server"],
      },
    });
    const duplicateSource = upsertMediaSource({
      providerId: "plex",
      providerAccountId: duplicateAccount.id,
      externalId: "plex-server-1",
      name: "plex.rackserver.dev",
      baseUrl: "https://172-18-0-29.example.plex.direct:32400",
      connection: {
        connections: [
          {
            id: "phone-connection",
            uri: "https://172-18-0-29.example.plex.direct:32400",
            local: false,
            relay: false,
          },
        ],
        selectedConnectionId: "phone-connection",
      },
      credentials: {
        accessToken: "phone-server-token",
      },
      metadata: {
        product: "Plex Media Server",
        platform: "Linux",
        owned: true,
        provides: ["server"],
      },
    });
    assert.ok(canonicalSource);
    assert.ok(duplicateSource);

    const duplicateSession = createProviderSession({
      providerId: "plex",
      providerAccountId: duplicateAccount.id,
      userToken: "phone-user-token",
    });
    const rememberedSession = createRememberedProviderSession(
      duplicateAccount.id,
    );

    const cleanup = cleanupDuplicatePlexSources({
      preferredAccountId: duplicateAccount.id,
    });

    assert.equal(cleanup.providerAccountId, canonicalAccount.id);
    assert.equal(cleanup.duplicateSourceCount, 1);
    assert.equal(cleanup.deletedAccountCount, 1);
    assert.equal(
      getProviderSession(duplicateSession.id)?.providerAccountId,
      canonicalAccount.id,
    );
    assert.equal(
      getRememberedProviderSession(rememberedSession.token)?.providerAccountId,
      canonicalAccount.id,
    );
    assert.equal(getProviderAccount(duplicateAccount.id), undefined);

    const sources = listMediaSources({ providerId: "plex" });
    assert.equal(sources.length, 1);
    assert.equal(sources[0]?.id, canonicalSource.id);
    assert.equal(sources[0]?.baseUrl, "https://manual.example:32400");
    assert.equal(sources[0]?.connection.baseUrlMode, PLEX_BASE_URL_MODE_MANUAL);
    assert.equal(sources[0]?.credentials.accessToken, "phone-server-token");
  });
});

void test("does not merge distinct Plex server identities", () => {
  withDatabase(() => {
    const firstAccount = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "Plex Account",
      accessToken: "first-user-token",
    });
    const secondAccount = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "Plex Account",
      accessToken: "second-user-token",
    });
    assert.ok(firstAccount);
    assert.ok(secondAccount);

    upsertMediaSource({
      providerId: "plex",
      providerAccountId: firstAccount.id,
      externalId: "plex-server-1",
      name: "Plex",
      baseUrl: "https://first.example:32400",
    });
    upsertMediaSource({
      providerId: "plex",
      providerAccountId: secondAccount.id,
      externalId: "plex-server-2",
      name: "Plex",
      baseUrl: "https://second.example:32400",
    });

    const cleanup = cleanupDuplicatePlexSources();

    assert.equal(cleanup.duplicateSourceCount, 0);
    assert.equal(listMediaSources({ providerId: "plex" }).length, 2);
    assert.ok(getProviderAccount(firstAccount.id));
    assert.ok(getProviderAccount(secondAccount.id));
  });
});

void test("keeps Jellyfin provider accounts token based", () => {
  withDatabase(() => {
    const firstAccount = persistProviderAuth({
      provider: jellyfinProvider,
      userToken: "first-jellyfin-token",
      resources: [
        {
          id: "jellyfin-server-1",
          name: "Jellyfin",
          accessToken: "first-jellyfin-token",
          connections: [
            {
              id: "first-connection",
              uri: "https://jellyfin.example",
              local: false,
              relay: false,
            },
          ],
        },
      ],
    });
    const secondAccount = persistProviderAuth({
      provider: jellyfinProvider,
      userToken: "second-jellyfin-token",
      resources: [
        {
          id: "jellyfin-server-1",
          name: "Jellyfin",
          accessToken: "second-jellyfin-token",
          connections: [
            {
              id: "second-connection",
              uri: "https://jellyfin.example",
              local: false,
              relay: false,
            },
          ],
        },
      ],
    });

    assert.notEqual(firstAccount.id, secondAccount.id);
    assert.equal(listMediaSources({ providerId: "jellyfin" }).length, 2);
  });
});
