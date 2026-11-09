import assert from "node:assert/strict";
import { mock, test } from "node:test";

import type {
  ProviderAuthStatus,
  ProviderSession,
} from "@cliparr/shared/providers";

import { cliparrClient } from "@/api/cliparrClient";
import { pollProviderAuth } from "#/components/provider-connect/pollProviderAuth";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const session: ProviderSession = {
  id: "session",
  providerId: "plex",
  expiresAt: "2030-01-01",
};

void test("polls sequentially and completes exactly once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const first = deferred<ProviderAuthStatus>();
  const second = deferred<ProviderAuthStatus>();
  let calls = 0;
  const poll = t.mock.method(cliparrClient, "pollAuth", () => {
    calls += 1;
    return calls === 1 ? first.promise : second.promise;
  });
  const getSession = t.mock.method(
    cliparrClient,
    "getSession",
    async () => session,
  );
  const onConnected = mock.fn();
  const onComplete = mock.fn();
  const stop = pollProviderAuth({
    providerId: "plex",
    authId: "auth",
    onConnected,
    onComplete,
    onExpired: mock.fn(),
    onError: mock.fn(),
  });

  t.mock.timers.tick(1500);
  t.mock.timers.tick(6000);
  assert.equal(poll.mock.callCount(), 1);
  first.resolve({ status: "pending" });
  await first.promise;
  await Promise.resolve();
  t.mock.timers.tick(1500);
  assert.equal(poll.mock.callCount(), 2);
  second.resolve({ status: "complete" });
  await second.promise;
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(6000);
  assert.equal(poll.mock.callCount(), 2);
  assert.equal(getSession.mock.callCount(), 1);
  assert.equal(onConnected.mock.callCount(), 1);
  assert.deepEqual(onConnected.mock.calls[0]?.arguments, [session]);
  assert.equal(onComplete.mock.callCount(), 1);
  stop();
});

void test("ignores a late poll response after cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = deferred<ProviderAuthStatus>();
  t.mock.method(cliparrClient, "pollAuth", () => pending.promise);
  const getSession = t.mock.method(
    cliparrClient,
    "getSession",
    async () => session,
  );
  const onConnected = mock.fn();
  const onExpired = mock.fn();
  const onError = mock.fn();
  const stop = pollProviderAuth({
    providerId: "plex",
    authId: "auth",
    onConnected,
    onComplete: mock.fn(),
    onExpired,
    onError,
  });
  t.mock.timers.tick(1500);
  stop();
  pending.resolve({ status: "complete" });
  await pending.promise;
  assert.equal(getSession.mock.callCount(), 0);
  assert.equal(onConnected.mock.callCount(), 0);
  assert.equal(onExpired.mock.callCount(), 0);
  assert.equal(onError.mock.callCount(), 0);
});

void test("ignores a session returned after cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = deferred<ProviderSession>();
  t.mock.method(cliparrClient, "pollAuth", async () => ({
    status: "complete",
  }));
  t.mock.method(cliparrClient, "getSession", () => pending.promise);
  const onConnected = mock.fn();
  const onError = mock.fn();
  const stop = pollProviderAuth({
    providerId: "plex",
    authId: "auth",
    onConnected,
    onComplete: mock.fn(),
    onExpired: mock.fn(),
    onError,
  });
  t.mock.timers.tick(1500);
  await Promise.resolve();
  stop();
  pending.resolve(session);
  await pending.promise;
  assert.equal(onConnected.mock.callCount(), 0);
  assert.equal(onError.mock.callCount(), 0);
});
