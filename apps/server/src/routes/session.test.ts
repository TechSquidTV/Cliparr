import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import {
  providerAccounts,
  providerSessions,
  rememberedProviderSessions,
} from "@/db/schema";
import { closeDatabase, getDatabase } from "@/db/database";
import { upsertProviderAccountByAccessToken } from "@/db/providerAccountsRepository";
import {
  createRememberedProviderSession,
  getRememberedProviderSession,
  revokeRememberedProviderSession,
} from "@/db/rememberedProviderSessionsRepository";
import { createApp } from "@/app";
import "@/providers/plex/provider";
import { purgeExpiredSessions } from "@/session/sweep";
import {
  createProviderSession,
  getProviderSession,
  getRememberedProviderSessionCookieName,
  getSessionCookieName,
} from "@/session/store";

const TEST_APP_KEY = "session-route-test-key-with-at-least-32-characters";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function readSetCookieValue(response: Response, name: string) {
  const prefix = `${name}=`;
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0]?.trim() ?? "")
    .find((entry) => entry.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : undefined;
}

function applyResponseCookies(jar: Map<string, string>, response: Response) {
  for (const header of response.headers.getSetCookie()) {
    const [pair, ...attributes] = header.split(";");
    assert.ok(pair);
    const separator = pair.indexOf("=");
    assert.ok(separator > 0);
    const name = pair.slice(0, separator);
    const expires = attributes.find((attribute) =>
      attribute.trim().startsWith("Expires="),
    );
    if (
      expires &&
      Date.parse(expires.trim().slice("Expires=".length)) <= Date.now()
    ) {
      jar.delete(name);
    } else {
      jar.set(name, pair.slice(separator + 1));
    }
  }
}

async function withTestApp<T>(
  callback: (baseUrl: string, fetchLocal: typeof fetch) => Promise<T>,
) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cliparr-session-"));
  const previousAppKey = process.env.APP_KEY;
  const previousDataDir = process.env.CLIPARR_DATA_DIR;

  process.env.APP_KEY = TEST_APP_KEY;
  process.env.CLIPARR_DATA_DIR = dataDir;

  const { app } = await createApp();
  const server = app.listen(0, "127.0.0.1");
  const originalFetch = globalThis.fetch;

  try {
    await new Promise((resolve) => {
      server.once("listening", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    return await callback(`http://127.0.0.1:${address.port}`, originalFetch);
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
    globalThis.fetch = originalFetch;
    closeDatabase();
    restoreEnv("APP_KEY", previousAppKey);
    restoreEnv("CLIPARR_DATA_DIR", previousDataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

void test("restoring via a remember cookie rotates the token", async () => {
  await withTestApp(async (baseUrl, fetchLocal) => {
    const account = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "Rotation test account",
      accessToken: "account-token",
    });
    assert.ok(account);
    const remembered = createRememberedProviderSession(account.id);

    // No session cookie: the remember credential is exercised.
    const response = await fetchLocal(`${baseUrl}/api/session`, {
      headers: {
        cookie: `${getRememberedProviderSessionCookieName()}=${remembered.token}`,
      },
    });
    assert.equal(response.status, 200);

    const rotatedToken = readSetCookieValue(
      response,
      getRememberedProviderSessionCookieName(),
    );
    assert.ok(rotatedToken);
    assert.notEqual(rotatedToken, remembered.token);

    // The old token is dead; the new one works.
    assert.equal(getRememberedProviderSession(remembered.token), undefined);
    const lookedUp = getRememberedProviderSession(rotatedToken);
    assert.ok(lookedUp);
    assert.equal(lookedUp.providerAccountId, account.id);

    // Presenting the old token now fails closed.
    const retry = await fetchLocal(`${baseUrl}/api/session`, {
      headers: {
        cookie: `${getRememberedProviderSessionCookieName()}=${remembered.token}`,
      },
    });
    assert.equal(retry.status, 401);
  });
});

void test("a live session cookie does not rotate the remember token", async () => {
  await withTestApp(async (baseUrl, fetchLocal) => {
    const account = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "No-rotation test account",
      accessToken: "account-token",
    });
    assert.ok(account);
    const session = createProviderSession({
      providerId: "plex",
      providerAccountId: account.id,
      userToken: "account-token",
    });
    const remembered = createRememberedProviderSession(account.id);

    const response = await fetchLocal(`${baseUrl}/api/session`, {
      headers: {
        cookie: [
          `${getSessionCookieName()}=${session.id}`,
          `${getRememberedProviderSessionCookieName()}=${remembered.token}`,
        ].join("; "),
      },
    });
    assert.equal(response.status, 200);

    // The remember credential was not exercised: no rotation.
    assert.equal(
      readSetCookieValue(response, getRememberedProviderSessionCookieName()),
      undefined,
    );
    assert.ok(getRememberedProviderSession(remembered.token));
  });
});

void test("concurrent restore responses preserve fresh credentials in a shared cookie jar in either order", async () => {
  await withTestApp(async (baseUrl, fetchLocal) => {
    const account = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "Concurrent account",
      accessToken: "account-token",
    });
    assert.ok(account);
    const remembered = createRememberedProviderSession(account.id);
    const responses = await Promise.all(
      [0, 1].map(() =>
        fetchLocal(`${baseUrl}/api/session`, {
          headers: {
            cookie: `${getRememberedProviderSessionCookieName()}=${remembered.token}; ${getSessionCookieName()}=stale`,
          },
        }),
      ),
    );
    assert.deepEqual(
      responses
        .map((response) => response.status)
        .toSorted((left, right) => left - right),
      [200, 401],
    );
    const winner = responses.find((response) => response.status === 200);
    const loser = responses.find((response) => response.status === 401);
    assert.ok(winner && loser);
    assert.deepEqual(loser.headers.getSetCookie(), []);
    const sessions = getDatabase().select().from(providerSessions).all();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.providerAccountId, account.id);
    const token = readSetCookieValue(
      winner,
      getRememberedProviderSessionCookieName(),
    );
    assert.ok(token);
    assert.equal(purgeExpiredSessions().purgedRememberedSessions, 1);
    assert.equal(
      getRememberedProviderSession(token)?.providerAccountId,
      account.id,
    );
    assert.equal(getRememberedProviderSession(remembered.token), undefined);

    // Model two tabs sharing one browser cookie jar, including a delayed 401
    // that arrives after the winner has installed both refreshed credentials.
    for (const orderedResponses of [
      [winner, loser],
      [loser, winner],
    ]) {
      const jar = new Map([
        [getRememberedProviderSessionCookieName(), remembered.token],
        [getSessionCookieName(), "stale"],
      ]);
      for (const response of orderedResponses) {
        applyResponseCookies(jar, response);
      }
      assert.equal(jar.get(getRememberedProviderSessionCookieName()), token);
      assert.equal(
        jar.get(getSessionCookieName()),
        readSetCookieValue(winner, getSessionCookieName()),
      );
      const resumed = await fetchLocal(`${baseUrl}/api/session`, {
        headers: {
          cookie: [...jar]
            .map(([name, value]) => `${name}=${value}`)
            .join("; "),
        },
      });
      assert.equal(resumed.status, 200);
      assert.equal(
        readSetCookieValue(resumed, getRememberedProviderSessionCookieName()),
        undefined,
      );
    }
  });
});

void test("a failed restore revokes the token without modifying shared cookies", async () => {
  await withTestApp(async (baseUrl, fetchLocal) => {
    const account = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "Failed account",
      accessToken: "account-token",
    });
    assert.ok(account);
    const remembered = createRememberedProviderSession(account.id);
    getDatabase()
      .update(providerAccounts)
      .set({ accessToken: null })
      .where(eq(providerAccounts.id, account.id))
      .run();
    const response = await fetchLocal(`${baseUrl}/api/session`, {
      headers: {
        cookie: `${getRememberedProviderSessionCookieName()}=${remembered.token}; ${getSessionCookieName()}=stale`,
      },
    });
    assert.equal(response.status, 401);
    assert.equal(
      readSetCookieValue(response, getRememberedProviderSessionCookieName()),
      undefined,
    );
    assert.equal(
      readSetCookieValue(response, getSessionCookieName()),
      undefined,
    );
    assert.equal(getRememberedProviderSession(remembered.token), undefined);
    assert.equal(
      getDatabase().select().from(rememberedProviderSessions).all().length,
      1,
    );
    assert.equal(purgeExpiredSessions().purgedRememberedSessions, 1);
    assert.equal(getDatabase().select().from(providerSessions).all().length, 0);
  });
});

void test("revocation during restore preserves shared cookies and the established session", async () => {
  await withTestApp(async (baseUrl, fetchLocal) => {
    const account = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "Race account",
      accessToken: "account-token",
    });
    assert.ok(account);
    const remembered = createRememberedProviderSession(account.id);
    // Model a revocation after validation but before rotation without mocking dependencies.
    getDatabase().run(
      sql`CREATE TRIGGER revoke_during_restore AFTER INSERT ON provider_sessions BEGIN UPDATE remembered_provider_sessions SET revoked_at = 1; END`,
    );
    const response = await fetchLocal(`${baseUrl}/api/session`, {
      headers: {
        cookie: `${getRememberedProviderSessionCookieName()}=${remembered.token}`,
      },
    });
    assert.equal(response.status, 200);
    assert.equal(
      readSetCookieValue(response, getRememberedProviderSessionCookieName()),
      undefined,
    );
    const sessionId = readSetCookieValue(response, getSessionCookieName());
    assert.equal(getProviderSession(sessionId)?.providerAccountId, account.id);
    assert.equal(purgeExpiredSessions().purgedRememberedSessions, 1);
    const retry = await fetchLocal(`${baseUrl}/api/session`, {
      headers: { cookie: `${getSessionCookieName()}=${sessionId}` },
    });
    assert.equal(retry.status, 200);
  });
});

void test("logout revokes the rotated token and removes the restored session after a sweep", async () => {
  await withTestApp(async (baseUrl, fetchLocal) => {
    const account = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "Logout account",
      accessToken: "account-token",
    });
    assert.ok(account);
    const remembered = createRememberedProviderSession(account.id);
    const restored = await fetchLocal(`${baseUrl}/api/session`, {
      headers: {
        cookie: `${getRememberedProviderSessionCookieName()}=${remembered.token}`,
      },
    });
    assert.equal(restored.status, 200);
    const token = readSetCookieValue(
      restored,
      getRememberedProviderSessionCookieName(),
    );
    const sessionId = readSetCookieValue(restored, getSessionCookieName());
    assert.ok(token && sessionId);
    purgeExpiredSessions();
    const response = await fetchLocal(`${baseUrl}/api/session`, {
      method: "DELETE",
      headers: {
        cookie: `${getRememberedProviderSessionCookieName()}=${token}; ${getSessionCookieName()}=${sessionId}`,
      },
    });
    assert.equal(response.status, 204);
    assert.equal(getRememberedProviderSession(token), undefined);
    assert.equal(getProviderSession(sessionId), undefined);
    assert.equal(
      readSetCookieValue(response, getRememberedProviderSessionCookieName()),
      "",
    );
    assert.equal(readSetCookieValue(response, getSessionCookieName()), "");
  });
});

void test("a live session takes precedence over a remember cookie for another account", async () => {
  await withTestApp(async (baseUrl, fetchLocal) => {
    const first = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "First",
      accessToken: "first-token",
    });
    const second = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "Second",
      accessToken: "second-token",
    });
    assert.ok(first && second);
    const session = createProviderSession({
      providerId: "plex",
      providerAccountId: first.id,
      userToken: "first-token",
    });
    const remembered = createRememberedProviderSession(second.id);
    const response = await fetchLocal(`${baseUrl}/api/session`, {
      headers: {
        cookie: `${getRememberedProviderSessionCookieName()}=${remembered.token}; ${getSessionCookieName()}=${session.id}`,
      },
    });
    assert.equal(response.status, 200);
    assert.equal(
      readSetCookieValue(response, getSessionCookieName()),
      session.id,
    );
    const token = readSetCookieValue(
      response,
      getRememberedProviderSessionCookieName(),
    );
    assert.equal(
      getRememberedProviderSession(token)?.providerAccountId,
      first.id,
    );
    assert.equal(getRememberedProviderSession(remembered.token), undefined);
  });
});

void test("revoked and swept tokens fail closed without modifying shared cookies", async () => {
  await withTestApp(async (baseUrl, fetchLocal) => {
    const account = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "Revoked",
      accessToken: "account-token",
    });
    assert.ok(account);
    const remembered = createRememberedProviderSession(account.id);
    revokeRememberedProviderSession(remembered.token);
    for (const swept of [false, true]) {
      if (swept) {
        purgeExpiredSessions();
      }
      const response = await fetchLocal(`${baseUrl}/api/session`, {
        headers: {
          cookie: `${getRememberedProviderSessionCookieName()}=${remembered.token}`,
        },
      });
      assert.equal(response.status, 401);
      assert.equal(
        readSetCookieValue(response, getRememberedProviderSessionCookieName()),
        undefined,
      );
      assert.equal(
        readSetCookieValue(response, getSessionCookieName()),
        undefined,
      );
    }
  });
});
