/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  createIdlePlaybackReadyRange,
  isPlaybackReadyRangeVisible,
  markPlaybackReadyRangeFresh,
  PLAYBACK_READY_RANGE_FRESH_MS,
  resetPlaybackReadyRangeWarmState,
} from "./editorPlaybackWarmupRange";

void test("does not show idle selection readiness", () => {
  const range = createIdlePlaybackReadyRange(10, 20);

  assert.equal(isPlaybackReadyRangeVisible(range), false);
});

void test("shows active warmup even before progress advances", () => {
  const range = markPlaybackReadyRangeFresh({
    startTime: 10,
    endTime: 20,
    readyUntilTime: 10,
    status: "warming",
  }, 1_000);

  assert.equal(isPlaybackReadyRangeVisible(range, 1_000), true);
});

void test("hides readiness after the freshness window expires", () => {
  const range = markPlaybackReadyRangeFresh({
    startTime: 10,
    endTime: 20,
    readyUntilTime: 20,
    status: "ready",
  }, 1_000);

  assert.equal(isPlaybackReadyRangeVisible(range, 1_000 + PLAYBACK_READY_RANGE_FRESH_MS - 1), true);
  assert.equal(isPlaybackReadyRangeVisible(range, 1_000 + PLAYBACK_READY_RANGE_FRESH_MS), false);
});

void test("resetting warm state removes prior progress", () => {
  const range = resetPlaybackReadyRangeWarmState({
    startTime: 10,
    endTime: 20,
    readyUntilTime: 20,
    status: "ready",
    updatedAtMs: 1_000,
    expiresAtMs: 31_000,
  });

  assert.deepEqual(range, {
    startTime: 10,
    endTime: 20,
    readyUntilTime: 10,
    status: "idle",
  });
});
