import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { setImmediate } from "node:timers/promises";

import { closeDatabase, initializeDatabase } from "@/db/database";
import {
  listMediaSources,
  updateMediaSource,
} from "@/db/mediaSourcesRepository";
import { isApiError } from "@/http/errors";
import { subscribePlaybackStateChanges } from "@/playback/stateChanges";
import { PLEX_BASE_URL_MODE_MANUAL } from "@/providers/plex/connectionState";
import { fetchCurrentlyPlayingData } from "@/providers/plex/playback";
import {
  selectReachableConnection,
  sourceResource,
} from "@/providers/plex/shared";
import { persistProviderAuth } from "@/providers/providerPersistence";
import { createDeferred } from "#test/deferred";
import {
  TEST_PLEX_BASE_URL,
  useProviderFixtures,
} from "#test/providerFixtures";
import { restoreEnv } from "#test/routeFixtures";

const ALTERNATIVE_URL = "http://backup.example.test:32400";

useProviderFixtures();

beforeEach((context) => {
  assert.ok("mock" in context);
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cliparr-plex-connections-"),
  );
  const previousAppKey = process.env.APP_KEY;
  const previousDataDir = process.env.CLIPARR_DATA_DIR;
  context.after(() => {
    closeDatabase();
    restoreEnv("APP_KEY", previousAppKey);
    restoreEnv("CLIPARR_DATA_DIR", previousDataDir);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  process.env.APP_KEY = "plex-connection-test-key-with-32-characters";
  process.env.CLIPARR_DATA_DIR = directory;
  initializeDatabase();
  persistProviderAuth({
    provider: { id: "plex", name: "Plex", auth: "pin" },
    userToken: "fixture-user-token",
    resources: [
      {
        id: "server",
        name: "Plex",
        accessToken: "fixture-server-token",
        owned: true,
        provides: ["server"],
        connections: [
          {
            id: "preferred",
            uri: TEST_PLEX_BASE_URL,
            local: true,
            relay: false,
          },
          {
            id: "alternative",
            uri: ALTERNATIVE_URL,
            local: false,
            relay: false,
          },
          {
            id: "third",
            uri: "http://third.example.test:32400",
            local: false,
            relay: false,
          },
        ],
      },
    ],
  });
});

function source() {
  const [stored] = listMediaSources();
  assert.ok(stored);
  return stored;
}

function sessionsResponse() {
  return Response.json({ MediaContainer: { Metadata: [] } });
}

void test("playback persists only the winner and prefers it on the next discovery", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const preferred = createDeferred<Response>();
  const started = createDeferred<void>();
  const requests: Request[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (...[input, init]: Parameters<typeof fetch>) => {
      const request = new Request(input, init);
      requests.push(request);
      assert.equal(new URL(request.url).pathname, "/status/sessions");
      assert.equal(request.headers.get("X-Plex-Token"), "fixture-server-token");
      if (request.url.startsWith(TEST_PLEX_BASE_URL)) {
        started.resolve();
        return preferred.promise;
      }
      return sessionsResponse();
    },
  );
  let writes = 0;
  context.after(
    subscribePlaybackStateChanges(() => {
      writes++;
    }),
  );
  const result = fetchCurrentlyPlayingData(source());
  await started.promise;
  context.mock.timers.tick(250);
  const selected = await result;
  assert.equal(selected.context.baseUrl, ALTERNATIVE_URL);
  assert.equal(requests[0]?.signal.aborted, true);
  assert.equal(source().baseUrl, ALTERNATIVE_URL);
  assert.equal(source().connection.selectedConnectionId, "alternative");
  assert.equal(source().connection.baseUrlMode, "auto");
  assert.equal(writes, 1);

  preferred.resolve(sessionsResponse());
  await setImmediate();
  assert.equal(source().baseUrl, ALTERNATIVE_URL);
  assert.equal(writes, 1);

  const repeated = await fetchCurrentlyPlayingData(source());
  assert.equal(repeated.context.baseUrl, ALTERNATIVE_URL);
  context.mock.timers.tick(5000);
  assert.equal(requests.length, 3);
  assert.ok(requests[2]?.url.startsWith(ALTERNATIVE_URL));
  assert.equal(writes, 1);
});

for (const status of [401, 403]) {
  void test(`playback stops on HTTP ${status}, cancels concurrent work, and preserves the saved connection`, async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const preferred = createDeferred<Response>();
    const alternative = createDeferred<Response>();
    const started = createDeferred<void>();
    const requests: Request[] = [];
    context.mock.method(
      globalThis,
      "fetch",
      async (...[input, init]: Parameters<typeof fetch>) => {
        const request = new Request(input, init);
        requests.push(request);
        if (requests.length === 2) {
          started.resolve();
        }
        return request.url.startsWith(TEST_PLEX_BASE_URL)
          ? preferred.promise
          : alternative.promise;
      },
    );
    const original = source();
    const result = fetchCurrentlyPlayingData(original);
    const rejected = assert.rejects(
      result,
      (error: unknown) =>
        isApiError(error) &&
        error.status === status &&
        error.code === "plex_request_failed",
    );
    context.mock.timers.tick(250);
    await started.promise;
    preferred.resolve(new Response(null, { status }));
    await rejected;
    await setImmediate();
    context.mock.timers.tick(5000);
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => request.signal.aborted));
    assert.deepEqual(source(), original);
    alternative.resolve(sessionsResponse());
    await setImmediate();
    assert.deepEqual(source(), original);
  });
}

for (const failure of [
  { label: "HTTP 401", response: () => new Response(null, { status: 401 }) },
  { label: "HTTP 403", response: () => new Response(null, { status: 403 }) },
  {
    label: "unsafe redirect",
    response: () =>
      new Response(null, {
        status: 302,
        headers: { Location: "ftp://blocked.example.test/resource" },
      }),
  },
]) {
  void test(`a speculative ${failure.label} cannot veto successful preferred playback`, async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const preferred = createDeferred<Response>();
    context.after(() => preferred.resolve(sessionsResponse()));
    const started = createDeferred<void>();
    const requests: Request[] = [];
    context.mock.method(
      globalThis,
      "fetch",
      async (...[input, init]: Parameters<typeof fetch>) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url.startsWith(TEST_PLEX_BASE_URL)) {
          started.resolve();
          return preferred.promise;
        }
        assert.ok(request.url.startsWith(ALTERNATIVE_URL));
        return failure.response();
      },
    );
    const original = source();
    const result = fetchCurrentlyPlayingData(original).then(
      (data) => ({ ok: true as const, data }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await started.promise;
    context.mock.timers.tick(250);
    await setImmediate();
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.signal.aborted, false);
    assert.deepEqual(source(), original);
    context.mock.timers.tick(150);
    preferred.resolve(sessionsResponse());
    const selected = await result;
    assert.ok(selected.ok);
    assert.equal(selected.data.context.baseUrl, TEST_PLEX_BASE_URL);
    assert.deepEqual(source(), original);
    context.mock.timers.tick(5000);
    assert.equal(requests.length, 2);
  });
}

void test("caller cancellation stops playback discovery without persisting a late result", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const response = createDeferred<Response>();
  const started = createDeferred<void>();
  const requests: Request[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (...[input, init]: Parameters<typeof fetch>) => {
      requests.push(new Request(input, init));
      started.resolve();
      return response.promise;
    },
  );
  const controller = new AbortController();
  const original = source();
  const result = fetchCurrentlyPlayingData(original, controller.signal);
  const reason = new Error("caller cancelled");
  const rejected = assert.rejects(result, (error: unknown) => error === reason);
  await started.promise;
  controller.abort(reason);
  await rejected;
  assert.equal(requests[0]?.signal.aborted, true);
  response.resolve(sessionsResponse());
  await setImmediate();
  context.mock.timers.tick(5000);
  assert.equal(requests.length, 1);
  assert.deepEqual(source(), original);
});

void test("manual playback uses only the configured URL and preserves it on success and failure", async (context) => {
  const original = source();
  const manualUrl = "http://manual.example.test:32400";
  updateMediaSource(original.id, {
    baseUrl: manualUrl,
    connection: {
      ...original.connection,
      baseUrlMode: PLEX_BASE_URL_MODE_MANUAL,
    },
  });
  const manual = source();
  let requests = 0;
  let available = true;
  context.mock.method(
    globalThis,
    "fetch",
    async (...[input, init]: Parameters<typeof fetch>) => {
      const request = new Request(input, init);
      requests++;
      assert.ok(request.url.startsWith(manualUrl));
      return available
        ? sessionsResponse()
        : new Response(null, { status: 503 });
    },
  );
  const selected = await fetchCurrentlyPlayingData(manual);
  assert.equal(selected.context.baseUrl, manualUrl);
  assert.deepEqual(source(), manual);
  available = false;
  await assert.rejects(
    fetchCurrentlyPlayingData(manual),
    (error: unknown) =>
      isApiError(error) &&
      error.code === "plex_unreachable" &&
      error.message.includes("configured server URL"),
  );
  assert.equal(requests, 2);
  assert.deepEqual(source(), manual);
});

void test("identity checks also stagger alternatives and cancel the stalled request", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const stalled = createDeferred<Response>();
  const started = createDeferred<void>();
  const requests: Request[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (...[input, init]: Parameters<typeof fetch>) => {
      const request = new Request(input, init);
      requests.push(request);
      assert.equal(new URL(request.url).pathname, "/identity");
      if (request.url.startsWith(TEST_PLEX_BASE_URL)) {
        started.resolve();
        return stalled.promise;
      }
      return Response.json({ MediaContainer: { machineIdentifier: "server" } });
    },
  );
  const { resource, preferredConnectionId } = sourceResource(source());
  const result = selectReachableConnection(resource, preferredConnectionId);
  await started.promise;
  context.mock.timers.tick(250);
  const selected = await result;
  assert.equal(selected.uri, ALTERNATIVE_URL);
  assert.equal(requests[0]?.signal.aborted, true);
  stalled.resolve(Response.json({ MediaContainer: {} }));
  await setImmediate();
  context.mock.timers.tick(5000);
  assert.equal(requests.length, 2);
});
