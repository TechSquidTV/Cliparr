import { createDeferred } from "#/lib/deferred.test-support";
import assert from "node:assert/strict";
import test from "node:test";
import { ensureAudioDecoder, ensureAudioEncoder } from "#/lib/mediabunnyCodecs";

void test("AC3 and EAC3 share one in-flight and completed decoder registration", async () => {
  const first = ensureAudioDecoder("ac3");
  assert.equal(ensureAudioDecoder("eac3"), first);
  await first;
  assert.equal(ensureAudioDecoder("ac3"), first);
  await ensureAudioDecoder(null);
  await ensureAudioDecoder("aac");
});

void test("encoder registration is shared for concurrent requests and retained after success", async () => {
  for (const codec of ["aac", "mp3", "flac"] as const) {
    const first = ensureAudioEncoder(codec);
    assert.equal(ensureAudioEncoder(codec), first);
    await first;
    assert.equal(ensureAudioEncoder(codec), first);
  }
});

void test("registration failures are shared and cleared before retry", async () => {
  const { createCodecRegistration } = await import("#/lib/mediabunnyCodecs");
  const failed = createDeferred<void>();
  const failure = new Error("Registration failed");
  let attempts = 0;
  const register = createCodecRegistration(() => {
    attempts += 1;
    return attempts === 1 ? failed.promise : Promise.resolve();
  });
  const first = register();
  const concurrent = register();
  assert.equal(first, concurrent);
  const rejections = [first, concurrent].map((promise) =>
    assert.rejects(promise, (error: Error) => error === failure),
  );
  failed.reject(failure);
  await Promise.all(rejections);
  assert.equal(attempts, 1);
  const retried = register();
  assert.notEqual(retried, first);
  await retried;
  assert.equal(register(), retried);
  assert.equal(attempts, 2);
});

void test("independent registrations do not block or invalidate each other", async () => {
  const { createCodecRegistration } = await import("#/lib/mediabunnyCodecs");
  const pending = createDeferred<void>();
  const first = createCodecRegistration(() => pending.promise);
  let attempts = 0;
  const second = createCodecRegistration(async () => {
    attempts += 1;
  });
  const waiting = first();
  const completed = second();
  await completed;
  pending.reject(new Error("Other codec failed"));
  await assert.rejects(waiting, /Other codec failed/);
  assert.equal(second(), completed);
  assert.equal(attempts, 1);
});
