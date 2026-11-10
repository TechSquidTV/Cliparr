import "@/providers/plex/provider";

import assert from "node:assert/strict";
import test from "node:test";

import { eq, sql } from "drizzle-orm";

import { getDatabase } from "@/db/database";
import { upsertProviderAccountByAccessToken } from "@/db/providerAccountsRepository";
import {
  createRememberedProviderSession,
  getRememberedProviderSession,
  revokeRememberedProviderSession,
} from "@/db/rememberedProviderSessionsRepository";
import {
  providerAccounts,
  providerSessions,
  rememberedProviderSessions,
} from "@/db/schema";
import { CREDENTIAL_COOKIE_NAMES } from "@/http/cookies";
import { createProviderSession, getProviderSession } from "@/session/store";
import { purgeExpiredSessions } from "@/session/sweep";
import { withTestApp } from "#test/routeFixtures";

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
        cookie: `${CREDENTIAL_COOKIE_NAMES.rememberedSession}=${remembered.token}`,
      },
    });
    assert.equal(response.status, 200);

    const rotatedToken = readSetCookieValue(
      response,
      CREDENTIAL_COOKIE_NAMES.rememberedSession,
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
        cookie: `${CREDENTIAL_COOKIE_NAMES.rememberedSession}=${remembered.token}`,
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
          `${CREDENTIAL_COOKIE_NAMES.session}=${session.id}`,
          `${CREDENTIAL_COOKIE_NAMES.rememberedSession}=${remembered.token}`,
        ].join("; "),
      },
    });
    assert.equal(response.status, 200);

    // The remember credential was not exercised: no rotation.
    assert.equal(
      readSetCookieValue(response, CREDENTIAL_COOKIE_NAMES.rememberedSession),
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
            cookie: `${CREDENTIAL_COOKIE_NAMES.rememberedSession}=${remembered.token}; ${CREDENTIAL_COOKIE_NAMES.session}=stale`,
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
      CREDENTIAL_COOKIE_NAMES.rememberedSession,
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
        [CREDENTIAL_COOKIE_NAMES.rememberedSession, remembered.token],
        [CREDENTIAL_COOKIE_NAMES.session, "stale"],
      ]);
      for (const response of orderedResponses) {
        applyResponseCookies(jar, response);
      }
      assert.equal(jar.get(CREDENTIAL_COOKIE_NAMES.rememberedSession), token);
      assert.equal(
        jar.get(CREDENTIAL_COOKIE_NAMES.session),
        readSetCookieValue(winner, CREDENTIAL_COOKIE_NAMES.session),
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
        readSetCookieValue(resumed, CREDENTIAL_COOKIE_NAMES.rememberedSession),
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
        cookie: `${CREDENTIAL_COOKIE_NAMES.rememberedSession}=${remembered.token}; ${CREDENTIAL_COOKIE_NAMES.session}=stale`,
      },
    });
    assert.equal(response.status, 401);
    assert.equal(
      readSetCookieValue(response, CREDENTIAL_COOKIE_NAMES.rememberedSession),
      undefined,
    );
    assert.equal(
      readSetCookieValue(response, CREDENTIAL_COOKIE_NAMES.session),
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
        cookie: `${CREDENTIAL_COOKIE_NAMES.rememberedSession}=${remembered.token}`,
      },
    });
    assert.equal(response.status, 200);
    assert.equal(
      readSetCookieValue(response, CREDENTIAL_COOKIE_NAMES.rememberedSession),
      undefined,
    );
    const sessionId = readSetCookieValue(
      response,
      CREDENTIAL_COOKIE_NAMES.session,
    );
    assert.equal(getProviderSession(sessionId)?.providerAccountId, account.id);
    assert.equal(purgeExpiredSessions().purgedRememberedSessions, 1);
    const retry = await fetchLocal(`${baseUrl}/api/session`, {
      headers: { cookie: `${CREDENTIAL_COOKIE_NAMES.session}=${sessionId}` },
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
        cookie: `${CREDENTIAL_COOKIE_NAMES.rememberedSession}=${remembered.token}`,
      },
    });
    assert.equal(restored.status, 200);
    const token = readSetCookieValue(
      restored,
      CREDENTIAL_COOKIE_NAMES.rememberedSession,
    );
    const sessionId = readSetCookieValue(
      restored,
      CREDENTIAL_COOKIE_NAMES.session,
    );
    assert.ok(token && sessionId);
    purgeExpiredSessions();
    const response = await fetchLocal(`${baseUrl}/api/session`, {
      method: "DELETE",
      headers: {
        cookie: `${CREDENTIAL_COOKIE_NAMES.rememberedSession}=${token}; ${CREDENTIAL_COOKIE_NAMES.session}=${sessionId}`,
      },
    });
    assert.equal(response.status, 204);
    assert.equal(getRememberedProviderSession(token), undefined);
    assert.equal(getProviderSession(sessionId), undefined);
    assert.equal(
      readSetCookieValue(response, CREDENTIAL_COOKIE_NAMES.rememberedSession),
      "",
    );
    assert.equal(
      readSetCookieValue(response, CREDENTIAL_COOKIE_NAMES.session),
      "",
    );
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
        cookie: `${CREDENTIAL_COOKIE_NAMES.rememberedSession}=${remembered.token}; ${CREDENTIAL_COOKIE_NAMES.session}=${session.id}`,
      },
    });
    assert.equal(response.status, 200);
    assert.equal(
      readSetCookieValue(response, CREDENTIAL_COOKIE_NAMES.session),
      session.id,
    );
    const token = readSetCookieValue(
      response,
      CREDENTIAL_COOKIE_NAMES.rememberedSession,
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
          cookie: `${CREDENTIAL_COOKIE_NAMES.rememberedSession}=${remembered.token}`,
        },
      });
      assert.equal(response.status, 401);
      assert.equal(
        readSetCookieValue(response, CREDENTIAL_COOKIE_NAMES.rememberedSession),
        undefined,
      );
      assert.equal(
        readSetCookieValue(response, CREDENTIAL_COOKIE_NAMES.session),
        undefined,
      );
    }
  });
});
