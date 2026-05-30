/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  clampClipEndTime,
  clampClipStartTime,
  clampPlaybackTime,
  formatTime,
  formatTimecodeInput,
  getTimelineFillPercentages,
  getFocusedTimelineZoomIndex,
  parseTimecodeInput,
  type TimelineZoomLevel,
} from "./editorUtils";
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

void test("keeps an explicit zoom anchor time visible when changing timeline zoom", () => {
  const update = resolveTimelineZoomUpdate({
    availableTimelineZoomLevels: zoomLevels,
    currentZoomIndex: 1,
    fallbackTimelineScale: zoomLevels[1],
    zoomDelta: -1,
    currentScrollLeft: 50,
    duration: 100,
    regionLeft: 100,
    regionWidth: 200,
    anchorTime: 0,
  });

  assert.deepEqual(update, {
    nextZoomIndex: 0,
    nextScrollLeft: 0,
  });
});

void test("does not zoom past the available timeline levels", () => {
  assert.equal(
    resolveTimelineZoomUpdate({
      availableTimelineZoomLevels: zoomLevels,
      currentZoomIndex: 0,
      fallbackTimelineScale: zoomLevels[0],
      zoomDelta: -1,
      currentScrollLeft: 0,
      duration: 100,
      regionLeft: 0,
      regionWidth: 200,
    }),
    null,
  );
});

void test("chooses an initial timeline zoom that keeps short selections editable", () => {
  const focusedLevels = [
    { scale: 1, scaleSplitCount: 10, scaleWidth: 160 },
    { scale: 5, scaleSplitCount: 5, scaleWidth: 120 },
    { scale: 600, scaleSplitCount: 5, scaleWidth: 152 },
  ] satisfies TimelineZoomLevel[];

  assert.equal(getFocusedTimelineZoomIndex(focusedLevels, 10, 900), 1);
  assert.equal(getFocusedTimelineZoomIndex(focusedLevels, 1, 900), 0);
});

void test("formats editor time with hours and sub-second precision when needed", () => {
  assert.equal(formatTime(7425), "2:03:45");
  assert.equal(formatTime(0.1), "0:00.10");
  assert.equal(formatTimecodeInput(7425), "2:03:45.00");
  assert.equal(formatTimecodeInput(0), "0:00.00");
});

void test("parses flexible editor timecode input", () => {
  assert.equal(parseTimecodeInput("90"), 90);
  assert.equal(parseTimecodeInput("90.5"), 90.5);
  assert.equal(parseTimecodeInput("1:30"), 90);
  assert.equal(parseTimecodeInput("1:30.25"), 90.25);
  assert.equal(parseTimecodeInput("1:02:03.04"), 3723.04);
  assert.equal(parseTimecodeInput("90:00"), 5400);
  assert.equal(parseTimecodeInput("0.105"), 0.11);
});

void test("rejects malformed editor timecode input", () => {
  assert.equal(parseTimecodeInput(""), null);
  assert.equal(parseTimecodeInput("-1"), null);
  assert.equal(parseTimecodeInput("1:"), null);
  assert.equal(parseTimecodeInput(":30"), null);
  assert.equal(parseTimecodeInput("1::30"), null);
  assert.equal(parseTimecodeInput("1:02:03:04"), null);
  assert.equal(parseTimecodeInput("1:60"), null);
  assert.equal(parseTimecodeInput("1:02:60"), null);
  assert.equal(parseTimecodeInput("1:60:00"), null);
});

void test("clamps direct timecode commits", () => {
  assert.equal(clampPlaybackTime(-1, 100), 0);
  assert.equal(clampPlaybackTime(101, 100), 100);
  assert.equal(clampPlaybackTime(0.105, 100), 0.11);
  assert.equal(clampClipStartTime(-1, 10, 100), 0);
  assert.equal(clampClipStartTime(9.95, 10, 100), 9.9);
  assert.equal(clampClipEndTime(5, 5, 100), 5.1);
  assert.equal(clampClipEndTime(120, 5, 100), 100);
});

void test("maps buffered timeline fill into action-relative percentages", () => {
  assert.deepEqual(
    getTimelineFillPercentages({
      trackStart: 10,
      trackEnd: 30,
      fillStart: 15,
      fillEnd: 25,
    }),
    {
      leftPercent: 25,
      widthPercent: 50,
    },
  );
});

void test("clamps buffered timeline fill to the action bounds", () => {
  assert.deepEqual(
    getTimelineFillPercentages({
      trackStart: 10,
      trackEnd: 30,
      fillStart: 0,
      fillEnd: 40,
    }),
    {
      leftPercent: 0,
      widthPercent: 100,
    },
  );

  assert.deepEqual(
    getTimelineFillPercentages({
      trackStart: 10,
      trackEnd: 30,
      fillStart: 10,
      fillEnd: 10,
    }),
    {
      leftPercent: 0,
      widthPercent: 0,
    },
  );
});

void test("combines horizontal and vertical wheel deltas for timeline scrolling", () => {
  assert.equal(
    resolveTimelineScrollWheelUpdate({
      deltaX: 20,
      deltaY: 30,
      deltaMode: 0,
      containerWidth: 200,
      containerHeight: 100,
      currentScrollLeft: 10,
      duration: 100,
      timelineScale: zoomLevels[1],
    }),
    60,
  );
});

void test("accumulates wheel zoom until the threshold is crossed", () => {
  assert.deepEqual(
    accumulateTimelineWheelZoomDelta({
      currentWheelDelta: 30,
      deltaY: 40,
      deltaMode: 0,
      containerHeight: 100,
    }),
    {
      accumulatedWheelDelta: 70,
      zoomDelta: 0,
    },
  );

  assert.deepEqual(
    accumulateTimelineWheelZoomDelta({
      currentWheelDelta: 70,
      deltaY: 20,
      deltaMode: 0,
      containerHeight: 100,
    }),
    {
      accumulatedWheelDelta: 0,
      zoomDelta: 1,
    },
  );
});

void test("resets accumulated wheel zoom when direction changes", () => {
  assert.deepEqual(
    accumulateTimelineWheelZoomDelta({
      currentWheelDelta: 50,
      deltaY: -20,
      deltaMode: 0,
      containerHeight: 100,
    }),
    {
      accumulatedWheelDelta: -20,
      zoomDelta: 0,
    },
  );
});
