import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../http/errors.js";
import { pollAuth, startAuth } from "./plex/auth.js";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json",
    },
  });
}

async function withMockedFetch<T>(
  handler: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
  action: () => Promise<T>
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
  await withMockedFetch(async (input) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    if (url === "https://plex.tv/api/v2/pins?strong=true") {
      return jsonResponse({
        id: 123,
        code: "ABCD",
        expiresIn: 60,
      });
    }

    if (url === "https://plex.tv/api/v2/pins/123") {
      return jsonResponse({
        authToken: "user-token",
      });
    }

    if (url === "https://clients.plex.tv/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=1") {
      return jsonResponse([{
        name: "Plex Server",
        provides: "server",
        owned: true,
        accessToken: "server-token",
        clientIdentifier: "server-1",
        connections: [{
          uri: "http://192.168.1.10:32400",
          local: true,
          relay: false,
        }],
      }]);
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }, async () => {
    const auth = await startAuth("http://cliparr.local/auth/plex/complete");

    assert.equal(auth.authId.length > 0, true);
    assert.equal(auth.pollToken.length > 20, true);

    await assert.rejects(
      () => pollAuth(auth.authId, "wrong-token"),
      (err: unknown) =>
        err instanceof ApiError
        && err.status === 401
        && err.code === "invalid_plex_auth_session"
    );

    const status = await pollAuth(auth.authId, auth.pollToken);
    assert.equal(status.status, "complete");
    assert.equal(status.userToken, "user-token");
    assert.equal(status.resources?.length, 1);
  });
});
