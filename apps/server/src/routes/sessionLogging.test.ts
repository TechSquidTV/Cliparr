import "@/providers/plex/provider";

import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import test from "node:test";

import { configure, getJsonLinesFormatter, reset } from "@logtape/logtape";
import { sql } from "drizzle-orm";

import { getDatabase } from "@/db/database";
import { upsertProviderAccountByAccessToken } from "@/db/providerAccountsRepository";
import { createRememberedProviderSession } from "@/db/rememberedProviderSessionsRepository";
import { CREDENTIAL_COOKIE_NAMES } from "@/http/cookies";
import { createProviderMediaHandle } from "@/providers/shared/mediaHandles";
import { createProviderSession, getProviderSession } from "@/session/store";
import { mockProviderDns, TEST_PLEX_BASE_URL } from "#test/providerFixtures";
import { withTestApp } from "#test/routeFixtures";

void test("server logs omit request credentials across authentication, media and failure paths", async (context) => {
  await withTestApp(async (baseUrl, fetchLocal) => {
    const lines: string[] = [];
    const format = getJsonLinesFormatter({ properties: "flatten" });
    await configure({
      reset: true,
      contextLocalStorage: new AsyncLocalStorage(),
      sinks: { capture: (record) => lines.push(format(record)) },
      loggers: [
        {
          category: ["logtape", "meta"],
          sinks: ["capture"],
          lowestLevel: "warning",
        },
        {
          category: ["cliparr", "server"],
          sinks: ["capture"],
          lowestLevel: "trace",
        },
      ],
    });
    context.after(reset);

    const account = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "Logging test",
      accessToken: "fixture-provider-token",
    });
    assert.ok(account?.accessToken);
    const remembered = createRememberedProviderSession(account.id);
    const restored = await fetchLocal(`${baseUrl}/api/session`, {
      headers: {
        cookie: `${CREDENTIAL_COOKIE_NAMES.rememberedSession}=${remembered.token}`,
      },
    });
    assert.equal(restored.status, 200);
    const cookie = restored.headers
      .getSetCookie()
      .find((value) => value.startsWith(`${CREDENTIAL_COOKIE_NAMES.session}=`))
      ?.split(";")[0];
    assert.ok(cookie);
    const credential = cookie.slice(CREDENTIAL_COOKIE_NAMES.session.length + 1);
    assert.ok(credential);
    const headers = { cookie };
    // Express parse errors carry the original body and can quote input in the message.
    for (const body of [
      "null",
      '{"password":"private-password-marker","value":BADINPUT}',
    ]) {
      const response = await fetchLocal(
        `${baseUrl}/api/providers/jellyfin/auth/login`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body,
        },
      );
      assert.equal(response.status, 400);
      assert.match(
        response.headers.get("content-type") ?? "",
        /^application\/json\b/,
      );
      assert.deepEqual(await response.json(), {
        error: {
          code: "invalid_json",
          message: "Request body must be a valid JSON object or array.",
        },
      });
    }
    assert.ok(lines.some((line) => line.includes("entity.parse.failed")));

    const discovery = await fetchLocal(
      `${baseUrl}/api/media/currently-playing`,
      { headers },
    );
    assert.equal(discovery.status, 200);
    const missing = await fetchLocal(`${baseUrl}/api/media/missing`, {
      headers,
    });
    assert.equal(missing.status, 404);
    const playbackSession = getProviderSession(credential);
    assert.ok(playbackSession);
    const playlist = createProviderMediaHandle(
      playbackSession,
      {
        providerId: "plex",
        sourceId: "plex-source",
        baseUrl: TEST_PLEX_BASE_URL,
        token: account.accessToken,
      },
      "/video/master.m3u8",
    );
    context.after(mockProviderDns(context.mock));
    context.mock.method(globalThis, "fetch", () =>
      Promise.resolve(
        new Response("#EXTM3U\n#EXTINF:4,\nsegment.ts\n", {
          headers: { "content-type": "application/vnd.apple.mpegurl" },
        }),
      ),
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetchLocal(baseUrl + playlist, { headers });
      assert.equal(response.status, 200);
      assert.match(await response.text(), /\/api\/media\//);
    }

    // Force a session lookup failure before the database can return a row.
    // The query error includes the bound cookie value even without a request query string.
    const session = createProviderSession({
      providerId: "plex",
      providerAccountId: account.id,
      userToken: account.accessToken,
    });
    getDatabase().run(
      sql`ALTER TABLE provider_sessions RENAME TO unavailable_sessions`,
    );
    const response = await fetchLocal(
      `${baseUrl}/api/session?debug=private-query-marker`,
      {
        headers: { cookie: `${CREDENTIAL_COOKIE_NAMES.session}=${session.id}` },
      },
    );
    assert.equal(response.status, 500);

    getDatabase().run(
      sql`ALTER TABLE unavailable_sessions RENAME TO provider_sessions`,
    );
    const logout = await fetchLocal(`${baseUrl}/api/session`, {
      method: "DELETE",
      headers,
    });
    assert.equal(logout.status, 204);
    const output = lines.join("\n");
    for (const event of [
      "session.restore",
      "playback.currently_playing",
      "media.proxy",
      "media.handle",
      "media.hls.playlist_rewrite",
      "media.hls.playlist_fetch",
      "media.proxy.cache",
      "session.disconnect",
      "unhandled_error",
    ]) {
      assert.ok(output.includes(JSON.stringify(event)), event);
    }
    assert.ok(output.includes("DrizzleQueryError"));
    for (const secret of [
      credential,
      session.id,
      remembered.token,
      "private-query-marker",
      "private-password-marker",
      "BADINPUT",
    ]) {
      assert.ok(
        !output.includes(secret),
        "structured log contains a credential or request query",
      );
    }
  });
});
