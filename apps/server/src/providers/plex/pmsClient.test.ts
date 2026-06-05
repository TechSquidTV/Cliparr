import assert from "node:assert/strict";
import test from "node:test";
import { isApiError } from "@/http/errors";
import {
  plexPmsResponseStatusMessage,
  requestPlexPmsCurrentSessions,
  requestPlexPmsIdentity,
  requestPlexPmsMetadata,
  type PlexPmsRequestContext,
  type PlexPmsRequestOptions,
} from "@/providers/plex/pmsClient";

const context: PlexPmsRequestContext = {
  baseUrl: "http://plex.local:32400",
  token: "server-token",
};

const options: PlexPmsRequestOptions = {
  clientIdentifier: "cliparr-test",
  product: "Cliparr",
  timeoutMs: 5000,
};

function withMockFetch(
  handler: (request: Request) => Response | Promise<Response>,
  callback: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    return handler(new Request(input, init));
  }) as typeof fetch;

  return callback().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");

  return Response.json(body, {
    ...init,
    headers,
  });
}

void test("requests current Plex sessions with Cliparr Plex headers", async () => {
  await withMockFetch(
    (request) => {
      assert.equal(request.url, "http://plex.local:32400/status/sessions");
      assert.equal(request.headers.get("Accept"), "application/json");
      assert.equal(request.headers.get("X-Plex-Token"), "server-token");
      assert.equal(request.headers.get("X-Plex-Product"), "Cliparr");
      assert.equal(
        request.headers.get("X-Plex-Client-Identifier"),
        "cliparr-test",
      );

      return jsonResponse({
        MediaContainer: {
          Metadata: [],
        },
      });
    },
    async () => {
      const data = await requestPlexPmsCurrentSessions(context, options);
      assert.deepEqual(data, {
        MediaContainer: {
          Metadata: [],
        },
      });
    },
  );
});

void test("serializes Plex metadata ids through the generated SDK", async () => {
  await withMockFetch(
    (request) => {
      assert.equal(request.url, "http://plex.local:32400/library/metadata/123");
      return jsonResponse({
        MediaContainer: {
          Metadata: [{ ratingKey: "123" }],
        },
      });
    },
    async () => {
      const data = await requestPlexPmsMetadata(context, ["123"], options);
      assert.deepEqual(data, {
        MediaContainer: {
          Metadata: [{ ratingKey: "123" }],
        },
      });
    },
  );
});

void test("validates Plex PMS redirects before following them", async () => {
  const requests: Request[] = [];

  await withMockFetch(
    (request) => {
      requests.push(request);
      if (request.url === "http://1.1.1.1:32400/identity") {
        return new Response(null, {
          status: 302,
          headers: {
            location: "http://[::ffff:127.0.0.1]:32400/identity",
          },
        });
      }

      throw new Error(`Unexpected request: ${request.url}`);
    },
    async () => {
      await assert.rejects(
        () =>
          requestPlexPmsIdentity(
            {
              baseUrl: "http://1.1.1.1:32400",
              token: "server-token",
            },
            options,
          ),
        (error: unknown) =>
          isApiError(error) &&
          error.status === 400 &&
          error.code === "plex_unsafe_redirect",
      );

      assert.deepEqual(
        requests.map((request) => request.url),
        ["http://1.1.1.1:32400/identity"],
      );
      assert.equal(requests[0]?.redirect, "manual");
    },
  );
});

void test("follows Plex PMS redirects to public targets without forwarding tokens", async () => {
  const requests: Request[] = [];

  await withMockFetch(
    (request) => {
      requests.push(request);
      if (request.url === "http://1.1.1.1:32400/identity") {
        return new Response(null, {
          status: 302,
          headers: {
            location: "http://1.1.1.2:32400/identity",
          },
        });
      }

      if (request.url === "http://1.1.1.2:32400/identity") {
        return jsonResponse({
          MediaContainer: {
            claimed: true,
            machineIdentifier: "plex-server-1",
            version: "1.41.0",
          },
        });
      }

      throw new Error(`Unexpected request: ${request.url}`);
    },
    async () => {
      const data = await requestPlexPmsIdentity(
        {
          baseUrl: "http://1.1.1.1:32400",
          token: "server-token",
        },
        options,
      );

      assert.deepEqual(data, {
        MediaContainer: {
          claimed: true,
          machineIdentifier: "plex-server-1",
          version: "1.41.0",
        },
      });
      assert.deepEqual(
        requests.map((request) => request.url),
        ["http://1.1.1.1:32400/identity", "http://1.1.1.2:32400/identity"],
      );
      assert.equal(requests[0]?.headers.get("X-Plex-Token"), "server-token");
      assert.equal(requests[1]?.headers.get("X-Plex-Token"), null);
    },
  );
});

void test("maps failed Plex PMS responses to Cliparr API errors", async () => {
  await withMockFetch(
    () =>
      jsonResponse(
        {
          error: "Unauthorized",
        },
        {
          status: 401,
          statusText: "Unauthorized",
        },
      ),
    async () => {
      let capturedError: unknown;
      await assert.rejects(
        async () => {
          try {
            await requestPlexPmsCurrentSessions(context, options);
          } catch (error) {
            capturedError = error;
            throw error;
          }
        },
        (error: unknown) =>
          isApiError(error) &&
          error.status === 401 &&
          error.code === "plex_request_failed" &&
          error.message === "Plex request failed: 401 Unauthorized",
      );
      assert.equal(
        plexPmsResponseStatusMessage(capturedError),
        "401 Unauthorized",
      );
    },
  );
});
