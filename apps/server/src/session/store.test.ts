import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_APP_KEY = "session-store-test-key-with-at-least-32-characters";
const MISMATCHED_APP_KEY =
  "session-store-test-key-with-a-different-32-char-secret";

const appModuleSpecifier = "#/app.js";
const databaseModuleSpecifier = "#/db/database.js";
const providerAccountsRepositoryModuleSpecifier =
  "#/db/providerAccountsRepository.js";
const rememberedProviderSessionsRepositoryModuleSpecifier =
  "#/db/rememberedProviderSessionsRepository.js";
const storeModuleSpecifier = "#/session/store.js";

function runStoreScript(
  script: string,
  options: {
    dataDir: string;
    appKey?: string;
  },
) {
  const child = spawnSync(
    process.execPath,
    [
      "--conditions=cliparr-source",
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      script,
    ],
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
        assert(!setCookies.some((cookie) => cookie.startsWith(\`\${getRememberedProviderSessionCookieName()}=\`)));
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

void test("clears invalid remembered provider session cookies from /api/session", () => {
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

void test("logout revokes the remembered provider session token", () => {
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
      const {
        createRememberedProviderSession,
        getRememberedProviderSession,
      } = await import(${JSON.stringify(rememberedProviderSessionsRepositoryModuleSpecifier)});
      const {
        createProviderSession,
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

        const session = createProviderSession({
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
        assert.equal(getRememberedProviderSession(rememberedSession.token), undefined);

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
