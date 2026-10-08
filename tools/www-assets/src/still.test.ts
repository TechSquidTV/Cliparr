import assert from "node:assert/strict";
import test from "node:test";
import type { AssetCaptureState } from "@cliparr/shared/asset-capture";
import { buildScenes, captureTarget, readmeSocialSeconds } from "#/scenes.ts";
import { stillFrameReady } from "#/still.ts";

void test("still-only capture excludes mobile and preserves the video scene", () => {
  const options = { hero: "hero.mkv", mobile: "mobile.mkv" };
  const full = buildScenes(options);
  const still = buildScenes({
    ...options,
    target: captureTarget("readme-social"),
    mobileSeconds: "invalid",
  });
  assert.deepEqual(still, [full[0]]);
  assert.equal(full.length, 2);
  assert.equal(captureTarget("all"), "all");
  assert.throws(() => captureTarget("social"));
  const hero = still[0];
  assert.ok(hero);
  assert.ok(Math.abs(readmeSocialSeconds(hero) - 496.72) < 0.000001);
  assert.throws(() =>
    readmeSocialSeconds({
      ...hero,
      selection: { ...hero.selection, outSeconds: readmeSocialSeconds(hero) },
    }),
  );
  assert.throws(() =>
    readmeSocialSeconds({
      ...hero,
      selection: { ...hero.selection, inSeconds: NaN },
    }),
  );
});

void test("still readiness rejects moving, undecoded, or subtitle-free frames", () => {
  const seconds = 496.72;
  const state: AssetCaptureState = {
    mediaReady: true,
    previewReady: true,
    duration: 1000,
    inSeconds: 496.07,
    outSeconds: 499.01,
    currentSeconds: seconds,
    renderedSeconds: seconds,
    frameStepSeconds: 1 / 24,
    playing: false,
    subtitlesReady: true,
    subtitleCueCount: 1,
    activeSubtitleCueCount: 1,
    subtitleTracks: [],
    error: "",
  };
  assert.equal(stillFrameReady(state, seconds), true);
  for (const change of [
    { playing: true },
    { previewReady: false },
    { subtitlesReady: false },
    { activeSubtitleCueCount: 0 },
    { renderedSeconds: null },
    { renderedSeconds: seconds + 0.2 },
    { currentSeconds: seconds + 0.2 },
    { error: "decoder failed" },
  ]) {
    assert.equal(stillFrameReady({ ...state, ...change }, seconds), false);
  }
});
