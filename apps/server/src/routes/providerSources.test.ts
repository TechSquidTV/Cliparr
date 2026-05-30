import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeDatabase } from "../db/database.js";
import {
  getMediaSourceByProviderExternalId,
  getMediaSourceForAccount,
  listMediaSources,
  upsertMediaSource,
} from "../db/mediaSourcesRepository.js";
import { upsertProviderAccountByAccessToken } from "../db/providerAccountsRepository.js";
import { createApp } from "../app.js";
import {
  createProviderSession,
  getSessionCookieName,
} from "../session/store.js";
import { PLEX_BASE_URL_MODE_MANUAL } from "../providers/plex/connectionState.js";

const TEST_APP_KEY = "provider-routes-test-key-with-at-least-32-characters";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function jsonResponse(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function cookieHeader(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

async function withTestApp<T>(
  callback: (baseUrl: string, fetchLocal: typeof fetch) => Promise<T>,
) {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cliparr-provider-routes-"),
  );
  const previousAppKey = process.env.APP_KEY;
  const previousDataDir = process.env.CLIPARR_DATA_DIR;

  process.env.APP_KEY = TEST_APP_KEY;
  process.env.CLIPARR_DATA_DIR = dataDir;

  const { app } = await createApp();
  const server = app.listen(0, "127.0.0.1");
  const originalFetch = globalThis.fetch;

  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert(address && typeof address === "object");
    return await callback(`http://127.0.0.1:${address.port}`, originalFetch);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve(undefined)));
    });
    globalThis.fetch = originalFetch;
    closeDatabase();
    restoreEnv("APP_KEY", previousAppKey);
    restoreEnv("CLIPARR_DATA_DIR", previousDataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function withMockedFetch<T>(
  handler: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
  action: () => Promise<T>,
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;

  try {
    return await action();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void test("completes Plex PIN auth through route cookies and persists sources", async () => {
  await withTestApp(async (baseUrl, fetchLocal) => {
    await withMockedFetch(
      async (input) => {
        const requestUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (requestUrl === "https://plex.tv/api/v2/pins?strong=true") {
          return jsonResponse({
            id: 321,
            code: "WXYZ",
            expiresIn: 60,
          });
        }

        if (requestUrl === "https://plex.tv/api/v2/pins/321") {
          return jsonResponse({
            authToken: "plex-user-token",
          });
        }

        if (
          requestUrl ===
          "https://clients.plex.tv/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=1"
        ) {
          return jsonResponse([
            {
              name: "Living Room Plex",
              product: "Plex Media Server",
              platform: "macOS",
              provides: "server",
              owned: true,
              accessToken: "plex-server-token",
              clientIdentifier: "plex-server-1",
              connections: [
                {
                  uri: "http://192.0.2.10:32400",
                  local: true,
                  relay: false,
                },
                {
                  uri: "https://relay.example.test",
                  local: false,
                  relay: true,
                },
              ],
            },
          ]);
        }

        throw new Error(`Unexpected fetch: ${requestUrl}`);
      },
      async () => {
        const startResponse = await fetchLocal(
          `${baseUrl}/api/providers/plex/auth/start`,
          {
            method: "POST",
          },
        );
        assert.equal(startResponse.status, 200);
        const startBody = (await startResponse.json()) as {
          authId?: string;
          authUrl?: string;
        };
        assert.equal(typeof startBody.authId, "string");
        assert.match(
          startBody.authUrl ?? "",
          /^https:\/\/app\.plex\.tv\/auth#/,
        );
        const authCookie = cookieHeader(startResponse);
        assert.match(authCookie, /cliparr_provider_auth=/);

        const rejectedPollResponse = await fetchLocal(
          `${baseUrl}/api/providers/plex/auth/${startBody.authId}`,
        );
        assert.equal(rejectedPollResponse.status, 401);
        const rejectedBody = (await rejectedPollResponse.json()) as {
          error?: { code?: string };
        };
        assert.equal(rejectedBody.error?.code, "invalid_provider_auth_session");

        const completeResponse = await fetchLocal(
          `${baseUrl}/api/providers/plex/auth/${startBody.authId}`,
          {
            headers: {
              cookie: authCookie,
            },
          },
        );
        assert.equal(completeResponse.status, 200);
        assert.deepEqual(await completeResponse.json(), { status: "complete" });
        const setCookies = completeResponse.headers.getSetCookie();
        assert(
          setCookies.some(
            (cookie) =>
              cookie.startsWith("cliparr_provider_auth=") &&
              cookie.includes("Expires=Thu, 01 Jan 1970 00:00:00 GMT"),
          ),
        );
        assert(
          setCookies.some((cookie) => cookie.startsWith("cliparr_session=")),
        );
        assert(
          setCookies.some((cookie) => cookie.startsWith("cliparr_remember=")),
        );

        const sources = listMediaSources({ providerId: "plex" });
        assert.equal(sources.length, 1);
        assert.equal(sources[0]?.name, "Living Room Plex");
        assert.equal(sources[0]?.baseUrl, "http://192.0.2.10:32400");
        assert.equal(sources[0]?.credentials.accessToken, "plex-server-token");
        assert.equal(sources[0]?.metadata.product, "Plex Media Server");
      },
    );
  });
});

void test("logs into Jellyfin with credentials and stores a remembered provider session", async () => {
  await withTestApp(async (baseUrl, fetchLocal) => {
    const upstreamRequests: Array<{ url: string; body?: string }> = [];

    await withMockedFetch(
      async (input, init) => {
        const requestUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        upstreamRequests.push({
          url: requestUrl,
          body: typeof init?.body === "string" ? init.body : undefined,
        });

        if (requestUrl === "http://1.1.1.1:8096/jellyfin/System/Info/Public") {
          return jsonResponse({
            Id: "jellyfin-server-1",
            ServerName: "Jelly Lab",
            ProductName: "Jellyfin",
            Version: "10.9.0",
          });
        }

        if (
          requestUrl === "http://1.1.1.1:8096/jellyfin/Users/AuthenticateByName"
        ) {
          return jsonResponse({
            AccessToken: "jellyfin-user-token",
            ServerId: "jellyfin-server-1",
            User: {
              Id: "admin-user",
              Name: "Admin",
              Policy: {
                IsAdministrator: true,
              },
            },
          });
        }

        throw new Error(`Unexpected fetch: ${requestUrl}`);
      },
      async () => {
        const response = await fetchLocal(
          `${baseUrl}/api/providers/jellyfin/auth/login`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              serverUrl: "http://1.1.1.1:8096/jellyfin/?discard=true#fragment",
              username: "admin",
              password: "secret",
            }),
          },
        );

        assert.equal(response.status, 200);
        const body = (await response.json()) as {
          session?: { providerId?: string };
        };
        assert.equal(body.session?.providerId, "jellyfin");
        const setCookies = response.headers.getSetCookie();
        assert(
          setCookies.some((cookie) => cookie.startsWith("cliparr_session=")),
        );
        assert(
          setCookies.some((cookie) => cookie.startsWith("cliparr_remember=")),
        );

        const authRequest = upstreamRequests.find((request) =>
          request.url.endsWith("/Users/AuthenticateByName"),
        );
        assert(authRequest?.body);
        assert.deepEqual(JSON.parse(authRequest.body), {
          Username: "admin",
          Pw: "secret",
        });

        const sources = listMediaSources({ providerId: "jellyfin" });
        assert.equal(sources.length, 1);
        assert.equal(sources[0]?.name, "Jelly Lab");
        assert.equal(sources[0]?.baseUrl, "http://1.1.1.1:8096/jellyfin");
        assert.equal(
          sources[0]?.credentials.accessToken,
          "jellyfin-user-token",
        );
        assert.equal(sources[0]?.credentials.userId, "admin-user");
        assert.equal(sources[0]?.metadata.username, "Admin");
      },
    );
  });
});

void test("updates sources with account isolation and preserves Plex manual URL mode", async () => {
  await withTestApp(async (baseUrl, fetchLocal) => {
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
    assert(account);
    assert(otherAccount);

    const source = upsertMediaSource({
      providerId: "plex",
      providerAccountId: account.id,
      externalId: "server-1",
      name: "Main Plex",
      baseUrl: "http://auto.example:32400",
      connection: {
        connections: [],
        selectedConnectionId: "auto",
      },
      credentials: {
        accessToken: "server-token",
      },
    });
    const otherSource = upsertMediaSource({
      providerId: "plex",
      providerAccountId: otherAccount.id,
      externalId: "server-2",
      name: "Other Plex",
      baseUrl: "http://other.example:32400",
    });
    assert(source);
    assert(otherSource);

    const session = createProviderSession({
      providerId: "plex",
      providerAccountId: account.id,
      userToken: "user-token",
    });
    const sessionCookie = `${getSessionCookieName()}=${session.id}`;

    const isolatedResponse = await fetchLocal(
      `${baseUrl}/api/sources/${otherSource.id}`,
      {
        headers: {
          cookie: sessionCookie,
        },
      },
    );
    assert.equal(isolatedResponse.status, 404);

    const rejectedPatchResponse = await fetchLocal(
      `${baseUrl}/api/sources/${source.id}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
        },
        body: JSON.stringify({
          credentials: {},
        }),
      },
    );
    assert.equal(rejectedPatchResponse.status, 400);
    const rejectedPatch = (await rejectedPatchResponse.json()) as {
      error?: { code?: string };
    };
    assert.equal(rejectedPatch.error?.code, "source_field_not_editable");

    const response = await fetchLocal(`${baseUrl}/api/sources/${source.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: sessionCookie,
      },
      body: JSON.stringify({
        name: " Main Plex Manual ",
        baseUrl: "https://manual.example/plex/?token=secret#section",
      }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      source?: { name?: string; baseUrl?: string };
    };
    assert.equal(body.source?.name, "Main Plex Manual");
    assert.equal(body.source?.baseUrl, "https://manual.example/plex");

    const updatedSource = getMediaSourceForAccount(source.id, account.id);
    assert(updatedSource);
    assert.equal(
      updatedSource.connection.baseUrlMode,
      PLEX_BASE_URL_MODE_MANUAL,
    );
    assert.equal(updatedSource.baseUrl, "https://manual.example/plex");

    const listResponse = await fetchLocal(`${baseUrl}/api/sources`, {
      headers: {
        cookie: sessionCookie,
      },
    });
    assert.equal(listResponse.status, 200);
    const listed = (await listResponse.json()) as {
      sources?: Array<{ id: string }>;
    };
    assert.deepEqual(
      listed.sources?.map((item) => item.id),
      [source.id],
    );
  });
});

void test("refreshes Jellyfin source health and persists check results", async () => {
  await withTestApp(async (baseUrl, fetchLocal) => {
    const account = upsertProviderAccountByAccessToken({
      providerId: "jellyfin",
      label: "Jellyfin Account",
      accessToken: "jellyfin-user-token",
    });
    assert(account);

    const source = upsertMediaSource({
      providerId: "jellyfin",
      providerAccountId: account.id,
      externalId: "jellyfin-server-1",
      name: "Jellyfin",
      baseUrl: "http://1.1.1.1:8096",
      credentials: {
        accessToken: "jellyfin-user-token",
        userId: "admin-user",
        deviceId: "device-1",
      },
      metadata: {
        serverName: "Jellyfin",
      },
    });
    assert(source);

    const session = createProviderSession({
      providerId: "jellyfin",
      providerAccountId: account.id,
      userToken: "jellyfin-user-token",
    });

    await withMockedFetch(
      async (input) => {
        const requestUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (requestUrl === "http://1.1.1.1:8096/System/Info/Public") {
          return jsonResponse({
            Id: "jellyfin-server-1",
            ServerName: "Jelly Lab",
            ProductName: "Jellyfin",
            Version: "10.9.1",
          });
        }

        if (requestUrl === "http://1.1.1.1:8096/Users/Me") {
          return jsonResponse({
            Id: "admin-user",
            Name: "Admin",
            Policy: {
              IsAdministrator: true,
            },
          });
        }

        if (
          requestUrl === "http://1.1.1.1:8096/Sessions?activeWithinSeconds=300"
        ) {
          return jsonResponse([]);
        }

        throw new Error(`Unexpected fetch: ${requestUrl}`);
      },
      async () => {
        const response = await fetchLocal(
          `${baseUrl}/api/sources/${source.id}/check`,
          {
            method: "POST",
            headers: {
              cookie: `${getSessionCookieName()}=${session.id}`,
            },
          },
        );

        assert.equal(response.status, 200);
        const body = (await response.json()) as {
          ok?: boolean;
          source?: { name?: string; lastError?: string | null };
        };
        assert.equal(body.ok, true);
        assert.equal(body.source?.name, "Jelly Lab");
        assert.equal(body.source?.lastError, null);

        const updatedSource = getMediaSourceByProviderExternalId(
          "jellyfin",
          account.id,
          "jellyfin-server-1",
        );
        assert(updatedSource);
        assert.equal(updatedSource.name, "Jelly Lab");
        assert.equal(updatedSource.lastError, undefined);
        assert.equal(updatedSource.metadata.version, "10.9.1");
        assert.match(updatedSource.lastCheckedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
      },
    );
  });
});
