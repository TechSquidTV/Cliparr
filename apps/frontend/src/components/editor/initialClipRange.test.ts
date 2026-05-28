/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClipRangeAfterDurationDiscovery,
  buildInitialClipRange,
} from "./initialClipRange";

void test("starts initial clip range at zero when no playhead is available", () => {
  assert.deepEqual(buildInitialClipRange(120), {
    startTime: 0,
    endTime: 10,
  });
});

void test("starts initial clip range at the provider playhead", () => {
  assert.deepEqual(buildInitialClipRange(120, 42.25), {
    startTime: 42.25,
    endTime: 52.25,
  });
});

void test("clamps initial clip range near the media end", () => {
  assert.deepEqual(buildInitialClipRange(100, 99.99), {
    startTime: 99.9,
    endTime: 100,
  });
});

void test("keeps rounded initial clip range within odd sub-second bounds", () => {
  const range = buildInitialClipRange(0.205, 0.105);

  assert.equal(range.endTime, 0.205);
  assert.equal(range.startTime <= 0.105, true);
  assert.equal(range.endTime <= 0.205, true);
});

void test("rebuilds initial clip range when duration is discovered later", () => {
  assert.deepEqual(buildClipRangeAfterDurationDiscovery({
    initialDuration: 0,
    currentStartTime: 0,
    currentEndTime: 0,
    discoveredDuration: 120,
  }), {
    startTime: 0,
    endTime: 10,
  });
});

void test("does not replace an existing clip range when duration is discovered later", () => {
  assert.equal(buildClipRangeAfterDurationDiscovery({
    initialDuration: 0,
    currentStartTime: 0,
    currentEndTime: 0.1,
    discoveredDuration: 120,
  }), null);
  assert.equal(buildClipRangeAfterDurationDiscovery({
    initialDuration: 120,
    currentStartTime: 0,
    currentEndTime: 10,
    discoveredDuration: 120,
  }), null);
});
