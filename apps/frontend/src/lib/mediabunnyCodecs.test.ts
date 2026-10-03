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
