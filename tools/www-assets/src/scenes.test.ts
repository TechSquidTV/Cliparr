import assert from "node:assert/strict";
import test from "node:test";
import { buildScenes, recordingDuration } from "#/scenes.ts";
import { validateVideo } from "#/encode.ts";

void test("keeps source selection separate from website recording length", () => {
  const [hero, mobile] = buildScenes({
    hero: "hero.mkv",
    mobile: "mobile.mkv",
  });
  assert.ok(hero && mobile);
  assert.deepEqual(hero.selection, { inSeconds: 496.07, outSeconds: 499.01 });
  assert.deepEqual(mobile.selection, { inSeconds: 1402, outSeconds: 1412 });
  assert.equal(hero.recordingSeconds, 82 / 30);
  assert.equal(mobile.recordingSeconds, 3);
  const changed = buildScenes({
    hero: "hero.mkv",
    mobile: "mobile.mkv",
    mobileSeconds: "8",
  });
  assert.deepEqual(changed[1]?.selection, mobile.selection);
  assert.equal(changed[1]?.recordingSeconds, 8);
});

void test("rejects recording windows that would create frozen trailing frames", () => {
  for (const value of ["0", "-1", "NaN", "Infinity", "11", ""]) {
    assert.throws(() => recordingDuration(value, 3, 10));
  }
});

void test("rejects accidentally downscaled, truncated, or audible video", () => {
  const [scene] = buildScenes({ hero: "hero.mp4", mobile: "mobile.mp4" });
  assert.ok(scene);
  const video = {
    codec_name: "h264",
    codec_type: "video",
    width: 1600,
    height: 886,
    pix_fmt: "yuv420p",
  };
  const details = { streams: [video], format: { duration: String(82 / 30) } };
  assert.doesNotThrow(() => validateVideo(details, scene, "h264"));
  assert.throws(() =>
    validateVideo(
      { ...details, streams: [{ ...video, width: 800 }] },
      scene,
      "h264",
    ),
  );
  assert.throws(() =>
    validateVideo(
      { ...details, streams: [video, { ...video, codec_type: "audio" }] },
      scene,
      "h264",
    ),
  );
  assert.throws(() =>
    validateVideo({ ...details, format: { duration: "1" } }, scene, "h264"),
  );
});
