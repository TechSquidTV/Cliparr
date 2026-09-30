import assert from "node:assert/strict";
import test from "node:test";
import { isApiError } from "@/http/errors";
import { pollAuth, startAuth } from "@/providers/plex/auth";

function jsonResponse(value: unknown) {
  return Response.json(value, {
    headers: {
      "content-type": "application/json",
    },
  });
}

function fetchInputUrl(input: Parameters<typeof fetch>[0]) {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

async function withMockedFetch<T>(
  handler: (
    ...arguments_: Parameters<typeof fetch>
  ) => ReturnType<typeof fetch>,
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

void test("requires the starter poll token before completing Plex auth", async () => {
  await withMockedFetch(
    async (input) => {
      const url = fetchInputUrl(input);

      if (url === "https://plex.tv/api/v2/pins?strong=true") {
        return jsonResponse({
          id: 123,
          code: "ABCD",
          expiresIn: 60,
        });
      }

      if (url === "https://plex.tv/api/v2/pins/123?code=ABCD") {
        return jsonResponse({
          authToken: "user-token",
        });
      }

      if (
        url ===
        "https://clients.plex.tv/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=1"
      ) {
        return jsonResponse([
          {
            name: "Plex Server",
            provides: "server",
            owned: true,
            accessToken: "server-token",
            clientIdentifier: "server-1",
            connections: [
              {
                uri: "http://192.168.1.10:32400",
                local: true,
                relay: false,
              },
            ],
          },
        ]);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    },
    async () => {
      const auth = await startAuth("http://cliparr.local/auth/plex/complete");

      assert.equal(auth.authId.length > 0, true);
      assert.equal(auth.pollToken.length > 20, true);

      await assert.rejects(
        () => pollAuth(auth.authId, "wrong-token"),
        (error: unknown) =>
          isApiError(error) &&
          error.status === 401 &&
          error.code === "invalid_plex_auth_session",
      );

      const status = await pollAuth(auth.authId, auth.pollToken);
      assert.equal(status.status, "complete");
      assert.equal(status.userToken, "user-token");
      assert.equal(status.resources?.length, 1);
    },
  );
});

void test("PIN polling keeps user credentials out of PMS resources and navigation uses the documented fragment", async () => {
  let polls = 0;
  await withMockedFetch(
    async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      assert.equal(request.headers.get("accept"), "application/json");
      assert.ok(request.headers.get("x-plex-client-identifier"));
      if (url.pathname === "/api/v2/resources") {
        assert.equal(request.headers.get("x-plex-token"), "cloud-user-token");
        return jsonResponse([
          {
            name: "Owned",
            provides: "server",
            owned: true,
            accessToken: "pms-only-token",
            connections: [{ uri: "https://plex.example" }],
          },
        ]);
      }
      assert.equal(request.headers.get("x-plex-token"), null);
      if (request.method === "POST") {
        return jsonResponse({ id: 456, code: "A & B", expiresIn: 60 });
      }
      assert.equal(url.pathname, "/api/v2/pins/456");
      assert.equal(url.searchParams.get("code"), "A & B");
      polls += 1;
      return jsonResponse({
        authToken: polls === 1 ? null : "cloud-user-token",
      });
    },
    async () => {
      const started = await startAuth(
        "https://cliparr.example/callback?x=1&y=2",
      );
      const navigation = new URL(started.authUrl);
      assert.equal(navigation.origin, "https://app.plex.tv");
      assert.equal(navigation.pathname, "/auth");
      const parameters = new URLSearchParams(navigation.hash.slice(2));
      assert.equal(parameters.get("code"), "A & B");
      assert.equal(
        parameters.get("forwardUrl"),
        "https://cliparr.example/callback?x=1&y=2",
      );
      const pending = await pollAuth(started.authId, started.pollToken);
      assert.equal(pending.status, "pending");
      const completed = await pollAuth(started.authId, started.pollToken);
      assert.equal(completed.status, "complete");
      assert.equal(completed.resources?.[0]?.accessToken, "pms-only-token");
      const expired = await pollAuth(started.authId, started.pollToken);
      assert.equal(expired.status, "expired");
    },
  );
});

void test("expired PIN sessions are removed before any cloud poll", async () => {
  let requests = 0;
  await withMockedFetch(
    async () => {
      requests += 1;
      return jsonResponse({ id: 789, code: "expired", expiresIn: -1 });
    },
    async () => {
      const started = await startAuth("https://cliparr.example/callback");
      const expired = await pollAuth(started.authId, started.pollToken);
      assert.equal(expired.status, "expired");
      assert.equal(requests, 1);
    },
  );
});
