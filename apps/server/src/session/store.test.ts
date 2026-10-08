import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_APP_KEY = "session-store-test-key-with-at-least-32-characters";
const MISMATCHED_APP_KEY =
  "session-store-test-key-with-a-different-32-char-secret";

const appModuleSpecifier = "@/app";
const databaseModuleSpecifier = "@/db/database";
const providerAccountsRepositoryModuleSpecifier =
  "@/db/providerAccountsRepository";
const mediaSourcesRepositoryModuleSpecifier = "@/db/mediaSourcesRepository";
const providerPersistenceModuleSpecifier = "@/providers/providerPersistence";
const rememberedProviderSessionsRepositoryModuleSpecifier =
  "@/db/rememberedProviderSessionsRepository";
const storeModuleSpecifier = "@/session/store";

function runStoreScript(
  script: string,
  options: {
    dataDir: string;
    appKey?: string;
  },
) {
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_KEY: options.appKey ?? TEST_APP_KEY,
        CLIPARR_DATA_DIR: options.dataDir,
      },
      encoding: "utf8",
    },
  );

  assert.equal(
    child.status,
    0,
    `child process failed with status ${child.status}\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`,
  );
  assert.equal(child.signal, null);

  return child.stdout.trim();
}

void test("restores a provider session from an opaque remembered provider session token", () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cliparr-session-store-"),
  );

  try {
    runStoreScript(
      `
      import assert from "node:assert/strict";

      const { initializeDatabase, closeDatabase } = await import(${JSON.stringify(databaseModuleSpecifier)});
      const { upsertProviderAccountByAccessToken } = await import(${JSON.stringify(providerAccountsRepositoryModuleSpecifier)});
      const {
        createRememberedProviderSession,
        getRememberedProviderSession,
        revokeRememberedProviderSession,
      } = await import(${JSON.stringify(rememberedProviderSessionsRepositoryModuleSpecifier)});
      const { restoreProviderSessionFromProviderAccount } = await import(${JSON.stringify(storeModuleSpecifier)});

      try {
        initializeDatabase();

        const account = upsertProviderAccountByAccessToken({
          providerId: "plex",
          label: "Plex Account",
          accessToken: "persisted-user-token",
        });

        assert(account);

        const rememberedSession = createRememberedProviderSession(account.id);
        assert.notEqual(rememberedSession.token, account.id);
        assert.equal(rememberedSession.providerAccountId, account.id);

        const matchedRememberedSession = getRememberedProviderSession(rememberedSession.token);
        assert(matchedRememberedSession);
        assert.equal(matchedRememberedSession.providerAccountId, account.id);

        const restoredSession = restoreProviderSessionFromProviderAccount(
          matchedRememberedSession.providerAccountId
        );

        assert(restoredSession);
        assert.equal(restoredSession.providerId, "plex");
        assert.equal(restoredSession.providerAccountId, account.id);
        assert.equal(restoredSession.userToken, "persisted-user-token");

        assert.equal(revokeRememberedProviderSession(rememberedSession.token), true);
        assert.equal(getRememberedProviderSession(rememberedSession.token), undefined);
      } finally {
        closeDatabase();
      }
    `,
      { dataDir },
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

void test("remembered provider session tokens are not reusable after APP_KEY changes", () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cliparr-session-store-"),
  );

  try {
    const token = runStoreScript(
      `
      const { initializeDatabase, closeDatabase } = await import(${JSON.stringify(databaseModuleSpecifier)});
      const { upsertProviderAccountByAccessToken } = await import(${JSON.stringify(providerAccountsRepositoryModuleSpecifier)});
      const { createRememberedProviderSession } = await import(${JSON.stringify(rememberedProviderSessionsRepositoryModuleSpecifier)});

      try {
        initializeDatabase();

        const account = upsertProviderAccountByAccessToken({
          providerId: "plex",
          label: "Plex Account",
          accessToken: "persisted-user-token",
        });

        const rememberedSession = createRememberedProviderSession(account.id);
        process.stdout.write(rememberedSession.token);
      } finally {
        closeDatabase();
      }
    `,
      { dataDir },
    );

    runStoreScript(
      `
      import assert from "node:assert/strict";

      const { initializeDatabase, closeDatabase } = await import(${JSON.stringify(databaseModuleSpecifier)});
      const { getRememberedProviderSession } = await import(${JSON.stringify(rememberedProviderSessionsRepositoryModuleSpecifier)});

      try {
        initializeDatabase();
        assert.equal(getRememberedProviderSession(${JSON.stringify(token)}), undefined);
      } finally {
        closeDatabase();
      }
    `,
      {
        dataDir,
        appKey: MISMATCHED_APP_KEY,
      },
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

void test("restores /api/session from a remembered provider session cookie", () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cliparr-session-route-"),
  );

  try {
    runStoreScript(
      `
      import assert from "node:assert/strict";

      const { createApp } = await import(${JSON.stringify(appModuleSpecifier)});
      const { closeDatabase } = await import(${JSON.stringify(databaseModuleSpecifier)});
      const { upsertProviderAccountByAccessToken } = await import(${JSON.stringify(providerAccountsRepositoryModuleSpecifier)});
      const { createRememberedProviderSession } = await import(${JSON.stringify(rememberedProviderSessionsRepositoryModuleSpecifier)});
      const { getRememberedProviderSessionCookieName, getSessionCookieName } = await import(${JSON.stringify(storeModuleSpecifier)});

      const { app } = await createApp();
      const server = app.listen(0, "127.0.0.1");

      try {
        await new Promise((resolve) => server.once("listening", resolve));
        const address = server.address();
        assert(address && typeof address === "object");

        const account = upsertProviderAccountByAccessToken({
          providerId: "plex",
          label: "Plex Account",
          accessToken: "persisted-user-token",
        });
        assert(account);

        const rememberedSession = createRememberedProviderSession(account.id);
        const response = await fetch(
          \`http://127.0.0.1:\${address.port}/api/session\`,
          {
            headers: {
              cookie: \`\${getRememberedProviderSessionCookieName()}=\${rememberedSession.token}\`,
            },
          }
        );

        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.session.providerId, "plex");

        const setCookies = response.headers.getSetCookie();
        assert(setCookies.some((cookie) => cookie.startsWith(\`\${getSessionCookieName()}=\`)));
        // Restoring via the remember credential rotates it: the response
        // carries a fresh remember token different from the presented one.
        const rotatedCookie = setCookies.find((cookie) =>
          cookie.startsWith(\`\${getRememberedProviderSessionCookieName()}=\`),
        );
        assert(rotatedCookie);
        assert(
          !rotatedCookie.startsWith(
            \`\${getRememberedProviderSessionCookieName()}=\${rememberedSession.token};\`,
          ),
        );
      } finally {
        await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve(undefined)));
        closeDatabase();
      }
    `,
      { dataDir },
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

void test("rejects invalid remembered provider session cookies without clearing shared cookies", () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cliparr-session-route-"),
  );

  try {
    runStoreScript(
      `
      import assert from "node:assert/strict";

      const { createApp } = await import(${JSON.stringify(appModuleSpecifier)});
      const { closeDatabase } = await import(${JSON.stringify(databaseModuleSpecifier)});
      const { getRememberedProviderSessionCookieName } = await import(${JSON.stringify(storeModuleSpecifier)});

      const { app } = await createApp();
      const server = app.listen(0, "127.0.0.1");

      try {
        await new Promise((resolve) => server.once("listening", resolve));
        const address = server.address();
        assert(address && typeof address === "object");

        const response = await fetch(
          \`http://127.0.0.1:\${address.port}/api/session\`,
          {
            headers: {
              cookie: \`\${getRememberedProviderSessionCookieName()}=invalid-token\`,
            },
          }
        );

        assert.equal(response.status, 401);
        const setCookies = response.headers.getSetCookie();
        assert.deepEqual(setCookies, []);
      } finally {
        await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve(undefined)));
        closeDatabase();
      }
    `,
      { dataDir },
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

void test("disconnect removes the provider account and cascades saved sources", () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cliparr-session-route-"),
  );

  try {
    runStoreScript(
      `
      import assert from "node:assert/strict";

      const { createApp } = await import(${JSON.stringify(appModuleSpecifier)});
      const { closeDatabase } = await import(${JSON.stringify(databaseModuleSpecifier)});
      const {
        getProviderAccount,
        upsertProviderAccountByAccessToken,
      } = await import(${JSON.stringify(providerAccountsRepositoryModuleSpecifier)});
      const {
        getMediaSourceByProviderExternalId,
        listMediaSources,
        upsertMediaSource,
      } = await import(${JSON.stringify(mediaSourcesRepositoryModuleSpecifier)});
      const { persistProviderAuth } = await import(${JSON.stringify(providerPersistenceModuleSpecifier)});
      const {
        createRememberedProviderSession,
        getRememberedProviderSession,
      } = await import(${JSON.stringify(rememberedProviderSessionsRepositoryModuleSpecifier)});
      const {
        createProviderSession,
        getProviderSession,
        getRememberedProviderSessionCookieName,
        getSessionCookieName,
      } = await import(${JSON.stringify(storeModuleSpecifier)});

      const { app } = await createApp();
      const server = app.listen(0, "127.0.0.1");

      try {
        await new Promise((resolve) => server.once("listening", resolve));
        const address = server.address();
        assert(address && typeof address === "object");

        const account = upsertProviderAccountByAccessToken({
          providerId: "plex",
          label: "Plex Account",
          accessToken: "persisted-user-token",
        });
        assert(account);
        const source = upsertMediaSource({
          providerId: "plex",
          providerAccountId: account.id,
          externalId: "plex-server-1",
          name: "Living Room Plex",
          baseUrl: "http://192.0.2.10:32400",
        });
        assert(source);

        const session = createProviderSession({
          providerId: "plex",
          providerAccountId: account.id,
          userToken: "persisted-user-token",
        });
        const otherSession = createProviderSession({
          providerId: "plex",
          providerAccountId: account.id,
          userToken: "persisted-user-token",
        });
        const rememberedSession = createRememberedProviderSession(account.id);
        const response = await fetch(
          \`http://127.0.0.1:\${address.port}/api/session\`,
          {
            method: "DELETE",
            headers: {
              cookie: [
                \`\${getSessionCookieName()}=\${session.id}\`,
                \`\${getRememberedProviderSessionCookieName()}=\${rememberedSession.token}\`,
              ].join("; "),
            },
          }
        );

        assert.equal(response.status, 204);
        assert.equal(getProviderAccount(account.id), undefined);
        assert.equal(getProviderSession(session.id), undefined);
        assert.equal(getProviderSession(otherSession.id), undefined);
        assert.equal(getRememberedProviderSession(rememberedSession.token), undefined);
        assert.equal(
          getMediaSourceByProviderExternalId("plex", account.id, "plex-server-1"),
          undefined
        );
        assert.equal(listMediaSources({ providerAccountId: account.id }).length, 0);

        const reauthenticatedAccount = persistProviderAuth({
          provider: {
            id: "plex",
            name: "Plex",
            auth: "pin",
          },
          userToken: "new-persisted-user-token",
          resources: [
            {
              id: "plex-server-1",
              name: "Living Room Plex",
              accessToken: "new-plex-server-token",
              connections: [
                {
                  id: "auto-connection",
                  uri: "http://192.0.2.10:32400",
                  local: true,
                  relay: false,
                },
              ],
            },
          ],
        });
        assert(reauthenticatedAccount);
        assert.notEqual(reauthenticatedAccount.id, account.id);
        assert.deepEqual(
          listMediaSources({ providerId: "plex" }).map((item) => item.externalId),
          ["plex-server-1"]
        );

        const setCookies = response.headers.getSetCookie();
        assert(setCookies.some((cookie) =>
          cookie.startsWith(\`\${getSessionCookieName()}=\`)
          && cookie.includes("Expires=Thu, 01 Jan 1970 00:00:00 GMT")
        ));
        assert(setCookies.some((cookie) =>
          cookie.startsWith(\`\${getRememberedProviderSessionCookieName()}=\`)
          && cookie.includes("Expires=Thu, 01 Jan 1970 00:00:00 GMT")
        ));
      } finally {
        await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve(undefined)));
        closeDatabase();
      }
    `,
      { dataDir },
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

void test("disconnect uses the remembered provider account when the session cookie is missing", () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cliparr-session-route-"),
  );

  try {
    runStoreScript(
      `
      import assert from "node:assert/strict";

      const { createApp } = await import(${JSON.stringify(appModuleSpecifier)});
      const { closeDatabase } = await import(${JSON.stringify(databaseModuleSpecifier)});
      const {
        getProviderAccount,
        upsertProviderAccountByAccessToken,
      } = await import(${JSON.stringify(providerAccountsRepositoryModuleSpecifier)});
      const {
        getMediaSourceByProviderExternalId,
        upsertMediaSource,
      } = await import(${JSON.stringify(mediaSourcesRepositoryModuleSpecifier)});
      const {
        createRememberedProviderSession,
        getRememberedProviderSession,
      } = await import(${JSON.stringify(rememberedProviderSessionsRepositoryModuleSpecifier)});
      const {
        getRememberedProviderSessionCookieName,
      } = await import(${JSON.stringify(storeModuleSpecifier)});

      const { app } = await createApp();
      const server = app.listen(0, "127.0.0.1");

      try {
        await new Promise((resolve) => server.once("listening", resolve));
        const address = server.address();
        assert(address && typeof address === "object");

        const account = upsertProviderAccountByAccessToken({
          providerId: "plex",
          label: "Plex Account",
          accessToken: "persisted-user-token",
        });
        assert(account);
        const source = upsertMediaSource({
          providerId: "plex",
          providerAccountId: account.id,
          externalId: "plex-server-1",
          name: "Living Room Plex",
          baseUrl: "http://192.0.2.10:32400",
        });
        assert(source);

        const rememberedSession = createRememberedProviderSession(account.id);
        const response = await fetch(
          \`http://127.0.0.1:\${address.port}/api/session\`,
          {
            method: "DELETE",
            headers: {
              cookie: \`\${getRememberedProviderSessionCookieName()}=\${rememberedSession.token}\`,
            },
          }
        );

        assert.equal(response.status, 204);
        assert.equal(getProviderAccount(account.id), undefined);
        assert.equal(getRememberedProviderSession(rememberedSession.token), undefined);
        assert.equal(
          getMediaSourceByProviderExternalId("plex", account.id, "plex-server-1"),
          undefined
        );

        const setCookies = response.headers.getSetCookie();
        assert(setCookies.some((cookie) =>
          cookie.startsWith(\`\${getRememberedProviderSessionCookieName()}=\`)
          && cookie.includes("Expires=Thu, 01 Jan 1970 00:00:00 GMT")
        ));
      } finally {
        await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve(undefined)));
        closeDatabase();
      }
    `,
      { dataDir },
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

function runSessionCacheScript(script: string) {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cliparr-session-cache-"),
  );
  try {
    runStoreScript(
      `
      import assert from "node:assert/strict";
      import { mock } from "node:test";
      import { eq } from "drizzle-orm";
      const { initializeDatabase, closeDatabase } = await import(${JSON.stringify(databaseModuleSpecifier)});
      const { providerSessions } = await import("@/db/schema");
      const { encryptSecret } = await import("@/security/secrets");
      const { upsertProviderAccountByAccessToken } = await import(${JSON.stringify(providerAccountsRepositoryModuleSpecifier)});
      const { createProviderSession, getProviderSession, deleteProviderSession, deleteProviderSessionsForProviderAccount } = await import(${JSON.stringify(storeModuleSpecifier)});
      try {
        const db = initializeDatabase();
        const account = upsertProviderAccountByAccessToken({
          providerId: "plex", label: "Cache account", accessToken: "user-token",
        });
        const createSession = () => createProviderSession({
          providerId: "plex", providerAccountId: account.id, userToken: "user-token",
        });
        mock.timers.enable({ apis: ["Date"], now: Date.now() });
        ${script}
      } finally {
        mock.restoreAll();
        mock.timers.reset();
        closeDatabase();
      }
    `,
      { dataDir },
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

void test("caches mapped sessions without another DB read and refreshes after a fixed TTL", () => {
  runSessionCacheScript(`
    const created = createSession();
    const select = mock.method(db, "select");
    const first = getProviderSession(created.id);
    assert(first);
    assert.equal(select.mock.callCount(), 1);
    assert.equal(first.mediaHandles, created.mediaHandles);
    assert.equal(first.userToken, "user-token");
    first.mediaHandles.set("live", {
      id: "live", providerId: "plex", sourceId: "source-1", baseUrl: "http://plex.example.test",
      path: "/segment.ts", token: "provider-token", lastAccessedAt: Date.now(),
    });
    db.update(providerSessions).set({ userToken: encryptSecret("new-user-token") })
      .where(eq(providerSessions.id, created.id)).run();
    mock.timers.tick(59_999);
    assert.equal(getProviderSession(created.id), first);
    assert.equal(select.mock.callCount(), 1);
    mock.timers.tick(1);
    const refreshed = getProviderSession(created.id);
    assert(refreshed);
    assert.notEqual(refreshed, first);
    assert.equal(select.mock.callCount(), 2);
    assert.equal(refreshed.userToken, "new-user-token");
    assert.equal(refreshed.mediaHandles, first.mediaHandles);
    assert.equal(refreshed.mediaHandles.size, 1);
  `);
});

void test("lazily deletes expired sessions on both cached and uncached reads", () => {
  runSessionCacheScript(`
    for (const cached of [false, true]) {
      const created = createSession();
      const expiresAt = Date.now() + 1000;
      db.update(providerSessions).set({ expiresAt }).where(eq(providerSessions.id, created.id)).run();
      if (cached) assert(getProviderSession(created.id));
      mock.timers.tick(1000);
      assert.equal(getProviderSession(created.id), undefined);
      assert.equal(db.select().from(providerSessions).where(eq(providerSessions.id, created.id)).get(), undefined);
      assert.equal(getProviderSession(created.id), undefined);
    }
  `);
});

void test("evicts cached sessions on single-session and account deletion", () => {
  runSessionCacheScript(`
    const single = createSession();
    const first = createSession();
    const second = createSession();
    const otherAccount = upsertProviderAccountByAccessToken({
      providerId: "plex", label: "Other account", accessToken: "other-token",
    });
    const other = createProviderSession({ providerId: "plex", providerAccountId: otherAccount.id, userToken: "other-token" });
    for (const session of [single, first, second, other]) assert(getProviderSession(session.id));
    const otherCached = getProviderSession(other.id);
    deleteProviderSession(single.id);
    assert.equal(getProviderSession(single.id), undefined);
    assert.equal(deleteProviderSessionsForProviderAccount(account.id), 2);
    assert.equal(getProviderSession(first.id), undefined);
    assert.equal(getProviderSession(second.id), undefined);
    assert.equal(getProviderSession(other.id), otherCached);
  `);
});

void test("caps the session cache at 128 entries and evicts the least recently used", () => {
  runSessionCacheScript(`
    const sessions = Array.from({ length: 129 }, createSession);
    const records = sessions.slice(0, 128).map((session) => getProviderSession(session.id));
    const select = mock.method(db, "select");
    assert.equal(getProviderSession(sessions[0].id), records[0]);
    assert(getProviderSession(sessions[128].id));
    assert.equal(select.mock.callCount(), 1);
    assert.equal(getProviderSession(sessions[0].id), records[0]);
    const reloaded = getProviderSession(sessions[1].id);
    assert(reloaded);
    assert.notEqual(reloaded, records[1]);
    assert.equal(reloaded.mediaHandles, records[1].mediaHandles);
    assert.equal(select.mock.callCount(), 2);
  `);
});

void test("disconnect revokes cached sessions immediately after a Plex account merge", () => {
  runSessionCacheScript(`
    const { createApp } = await import(${JSON.stringify(appModuleSpecifier)});
    const { getProviderAccount } = await import(${JSON.stringify(providerAccountsRepositoryModuleSpecifier)});
    const { upsertMediaSource } = await import(${JSON.stringify(mediaSourcesRepositoryModuleSpecifier)});
    const { cleanupDuplicatePlexSources } = await import("@/providers/plex/sourceDeduplication");
    const { getSessionCookieName } = await import(${JSON.stringify(storeModuleSpecifier)});
    const { PLEX_BASE_URL_MODE_MANUAL } = await import("@/providers/plex/connectionState");
    const { app } = await createApp();
    const duplicate = upsertProviderAccountByAccessToken({
      providerId: "plex", label: "Duplicate", accessToken: "duplicate-token",
    });
    for (const owner of [account, duplicate]) {
      upsertMediaSource({
        providerId: "plex", providerAccountId: owner.id, externalId: "same-server",
        name: "Test server", baseUrl: "https://example.com:32400",
        connection: owner === account ? { baseUrlMode: PLEX_BASE_URL_MODE_MANUAL } : {},
        credentials: { accessToken: "test-source-token" },
      });
    }
    const sessions = Array.from({ length: 2 }, () => createProviderSession({
      providerId: "plex", providerAccountId: duplicate.id, userToken: "duplicate-token",
    }));
    for (const session of sessions) {
      assert.equal(getProviderSession(session.id).providerAccountId, duplicate.id);
    }
    cleanupDuplicatePlexSources({ newlyAuthenticatedAccountId: duplicate.id });
    assert.equal(getProviderAccount(duplicate.id), undefined);
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise((resolve) => server.once("listening", resolve));
      const address = server.address();
      assert(address && typeof address === "object");
      const response = await fetch(\`http://127.0.0.1:\${address.port}/api/session\`, {
        method: "DELETE",
        headers: { cookie: \`\${getSessionCookieName()}=\${sessions[0].id}\` },
      });
      assert.equal(response.status, 204);
      assert.equal(getProviderAccount(account.id), undefined);
      for (const session of sessions) assert.equal(getProviderSession(session.id), undefined);
      assert.equal(db.select().from(providerSessions).all().length, 0);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  `);
});
