import assert from "node:assert/strict";
import test from "node:test";
import { isApiError } from "@/http/errors";
import {
  plexPmsResponseStatusMessage,
  requestPlexPmsCurrentSessions,
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
  globalThis.fetch = (async (input) => {
    assert(input instanceof Request);
    return handler(input);
  }) as typeof fetch;

  return callback().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");

  return new Response(JSON.stringify(body), {
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
