/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import type { TimelineZoomLevel } from "./EditorUtils";
import {
  accumulateTimelineWheelZoomDelta,
  resolveTimelineScrollWheelUpdate,
  resolveTimelineZoomUpdate,
} from "./timelineZoom";

const zoomLevels = [
  { scale: 5, scaleSplitCount: 5, scaleWidth: 100 },
  { scale: 10, scaleSplitCount: 5, scaleWidth: 100 },
] satisfies TimelineZoomLevel[];

void test("keeps the cursor-anchored time stable when changing timeline zoom", () => {
  const update = resolveTimelineZoomUpdate({
    availableTimelineZoomLevels: zoomLevels,
    currentZoomIndex: 1,
    fallbackTimelineScale: zoomLevels[1],
    zoomDelta: -1,
    currentScrollLeft: 50,
    duration: 100,
    regionLeft: 100,
    regionWidth: 200,
    anchorClientX: 200,
  });

  assert.deepEqual(update, {
    nextZoomIndex: 0,
    nextScrollLeft: 176,
  });
});

void test("does not zoom past the available timeline levels", () => {
  assert.equal(resolveTimelineZoomUpdate({
    availableTimelineZoomLevels: zoomLevels,
    currentZoomIndex: 0,
    fallbackTimelineScale: zoomLevels[0],
    zoomDelta: -1,
    currentScrollLeft: 0,
    duration: 100,
    regionLeft: 0,
    regionWidth: 200,
  }), null);
});

void test("combines horizontal and vertical wheel deltas for timeline scrolling", () => {
  assert.equal(resolveTimelineScrollWheelUpdate({
    deltaX: 20,
    deltaY: 30,
    deltaMode: 0,
    containerWidth: 200,
    containerHeight: 100,
    currentScrollLeft: 10,
    duration: 100,
    timelineScale: zoomLevels[1],
  }), 60);
});

void test("accumulates wheel zoom until the threshold is crossed", () => {
  assert.deepEqual(accumulateTimelineWheelZoomDelta({
    currentWheelDelta: 30,
    deltaY: 40,
    deltaMode: 0,
    containerHeight: 100,
  }), {
    accumulatedWheelDelta: 70,
    zoomDelta: 0,
  });

  assert.deepEqual(accumulateTimelineWheelZoomDelta({
    currentWheelDelta: 70,
    deltaY: 20,
    deltaMode: 0,
    containerHeight: 100,
  }), {
    accumulatedWheelDelta: 0,
    zoomDelta: 1,
  });
});

void test("resets accumulated wheel zoom when direction changes", () => {
  assert.deepEqual(accumulateTimelineWheelZoomDelta({
    currentWheelDelta: 50,
    deltaY: -20,
    deltaMode: 0,
    containerHeight: 100,
  }), {
    accumulatedWheelDelta: -20,
    zoomDelta: 0,
  });
});
