import assert from "node:assert/strict";
import test from "node:test";

import { isApiError } from "@/http/errors";
import { selectPlexConnection } from "@/providers/plex/shared";
import type { ProviderResource } from "@/providers/types";
import { createDeferred } from "#test/deferred";

function createResource(): ProviderResource {
  return {
    id: "server",
    name: "Plex",
    accessToken: "fixture-token",
    connections: [
      {
        id: "relay",
        uri: "https://relay.example.test",
        local: false,
        relay: true,
      },
      {
        id: "remote",
        uri: "https://remote.example.test",
        local: false,
        relay: false,
      },
      {
        id: "local",
        uri: "http://local.example.test:32400",
        local: true,
        relay: false,
      },
    ],
  };
}

void test("a successful preferred connection avoids starting alternatives", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const calls: string[] = [];
  const result = await selectPlexConnection(
    createResource(),
    "remote",
    async (connection) => {
      calls.push(connection.id);
      return "sessions";
    },
  );
  context.mock.timers.tick(5000);
  assert.equal(result.connection.id, "remote");
  assert.equal(result.data, "sessions");
  assert.deepEqual(calls, ["remote"]);
});

void test("a reachable alternative wins after 250 ms without waiting for a stalled preferred request", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const stalled = createDeferred<string>();
  const calls: string[] = [];
  const signals: AbortSignal[] = [];
  const result = selectPlexConnection(
    createResource(),
    "remote",
    (connection, signal) => {
      calls.push(connection.id);
      signals.push(signal);
      return connection.id === "remote"
        ? stalled.promise
        : Promise.resolve("sessions");
    },
  );
  context.mock.timers.tick(249);
  assert.deepEqual(calls, ["remote"]);
  context.mock.timers.tick(1);
  const selected = await result;
  assert.equal(selected.connection.id, "local");
  assert.deepEqual(calls, ["remote", "local"]);
  assert.ok(signals.every((signal) => signal.aborted));
  // A transport that completes despite cancellation cannot replace the winner.
  stalled.resolve("late sessions");
  context.mock.timers.tick(5000);
  assert.deepEqual(calls, ["remote", "local"]);
});

void test("at most two requests run concurrently and a failure immediately frees a slot", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const preferred = createDeferred<string>();
  const backup = createDeferred<string>();
  const calls: string[] = [];
  const result = selectPlexConnection(
    createResource(),
    "relay",
    (connection) => {
      calls.push(connection.id);
      if (connection.id === "relay") {
        return preferred.promise;
      }
      return connection.id === "local"
        ? backup.promise
        : Promise.resolve("sessions");
    },
  );
  context.mock.timers.tick(250);
  context.mock.timers.tick(5000);
  assert.deepEqual(calls, ["relay", "local"]);
  backup.reject(new Error("unreachable"));
  const selected = await result;
  assert.equal(selected.connection.id, "remote");
  assert.deepEqual(calls, ["relay", "local", "remote"]);
  preferred.resolve("late sessions");
});

void test("fast failures advance immediately and retain local-before-relay ordering", async () => {
  const calls: string[] = [];
  const result = await selectPlexConnection(
    createResource(),
    "remote",
    async (connection) => {
      calls.push(connection.id);
      if (connection.id !== "relay") {
        throw new Error("unreachable");
      }
      return "sessions";
    },
  );
  assert.equal(result.connection.id, "relay");
  assert.deepEqual(calls, ["remote", "local", "relay"]);
});

void test("the preferred request can still win after an alternative starts", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const preferred = createDeferred<string>();
  const alternative = createDeferred<string>();
  const calls: string[] = [];
  const result = selectPlexConnection(
    createResource(),
    "remote",
    (connection) => {
      calls.push(connection.id);
      return connection.id === "remote"
        ? preferred.promise
        : alternative.promise;
    },
  );
  context.mock.timers.tick(250);
  assert.deepEqual(calls, ["remote", "local"]);
  preferred.resolve("preferred sessions");
  const selected = await result;
  assert.equal(selected.connection.id, "remote");
  alternative.reject(new Error("cancelled alternative"));
});

void test("synchronous request failures advance without leaving stagger timers behind", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const calls: string[] = [];
  const result = await selectPlexConnection(
    createResource(),
    "remote",
    (connection) => {
      calls.push(connection.id);
      if (connection.id !== "relay") {
        throw new Error("unreachable");
      }
      return Promise.resolve("sessions");
    },
  );
  assert.equal(result.connection.id, "relay");
  context.mock.timers.tick(5000);
  assert.deepEqual(calls, ["remote", "local", "relay"]);
});

void test("manual selection never tries discovered alternatives", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = createDeferred<string>();
  const calls: string[] = [];
  const result = selectPlexConnection(
    createResource(),
    "remote",
    (connection) => {
      calls.push(connection.id);
      return pending.promise;
    },
    { baseUrlMode: "manual" },
  );
  const rejected = assert.rejects(
    result,
    (error: unknown) =>
      isApiError(error) &&
      error.code === "plex_unreachable" &&
      error.message.includes("configured server URL"),
  );
  context.mock.timers.tick(5000);
  assert.deepEqual(calls, ["remote"]);
  pending.reject(new Error("unreachable"));
  await rejected;
  assert.deepEqual(calls, ["remote"]);
});

void test("all connection failures are reported in candidate order", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const preferred = createDeferred<string>();
  const result = selectPlexConnection(
    createResource(),
    "remote",
    (connection) =>
      connection.id === "remote"
        ? preferred.promise
        : Promise.reject(new Error(connection.id)),
  );
  const rejected = assert.rejects(result, (error: unknown) => {
    assert.ok(isApiError(error));
    assert.equal(error.code, "plex_unreachable");
    assert.match(
      error.message,
      /remote\.example\.test: preferred; http:\/\/local\.example\.test:32400: local; https:\/\/relay\.example\.test: relay$/,
    );
    return true;
  });
  context.mock.timers.tick(250);
  preferred.reject(new Error("preferred"));
  await rejected;
});

void test("caller cancellation aborts running requests and cancels queued attempts", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  const pending = createDeferred<string>();
  const calls: string[] = [];
  let attemptSignal: AbortSignal | undefined;
  const result = selectPlexConnection(
    createResource(),
    "remote",
    (connection, signal) => {
      calls.push(connection.id);
      attemptSignal = signal;
      return pending.promise;
    },
    { signal: controller.signal },
  );
  const reason = new Error("caller cancelled");
  const rejected = assert.rejects(result, (error: unknown) => error === reason);
  controller.abort(reason);
  await rejected;
  assert.equal(attemptSignal?.aborted, true);
  context.mock.timers.tick(5000);
  assert.deepEqual(calls, ["remote"]);
  pending.resolve("late sessions");
});

void test("an already cancelled caller starts no requests", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    selectPlexConnection(
      createResource(),
      "remote",
      () => {
        assert.fail("cancelled selection must not request a connection");
      },
      { signal: controller.signal },
    ),
    { name: "AbortError" },
  );
});

void test("caller cancellation aborts both concurrent attempts", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  const pending = createDeferred<string>();
  const signals: AbortSignal[] = [];
  const result = selectPlexConnection(
    createResource(),
    "remote",
    (_connection, signal) => {
      signals.push(signal);
      return pending.promise;
    },
    { signal: controller.signal },
  );
  const rejected = assert.rejects(result, { name: "AbortError" });
  context.mock.timers.tick(250);
  assert.equal(signals.length, 2);
  controller.abort();
  await rejected;
  assert.ok(signals.every((signal) => signal.aborted));
  context.mock.timers.tick(5000);
  assert.equal(signals.length, 2);
  pending.reject(new Error("cancelled requests"));
});

void test("an empty connection list reports an unreachable server", async () => {
  await assert.rejects(
    selectPlexConnection({ ...createResource(), connections: [] }, "", () => {
      assert.fail("empty connection list must not request a connection");
    }),
    (error: unknown) => isApiError(error) && error.code === "plex_unreachable",
  );
});
