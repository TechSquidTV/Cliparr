import assert from "node:assert/strict";
import { test } from "node:test";
import { TimelineEngine, fromSeconds } from "@techsquidtv/canvas-timeline";
import {
  viewportRangeAfterZoomDrag,
  viewportScrollbarGeometry,
  zoomEditorTimeline,
} from "@/components/editor/editorTimelineZoom";

void test("scrollbar width changes at every zoom step on a long movie", () => {
  const widths = [1, 2, 4, 8].map((span) => {
    const geometry = viewportScrollbarGeometry({
      start: 1800,
      span,
      duration: 3600,
      minSpan: 1,
      viewportWidth: 1000,
    });
    return geometry.value.end - geometry.value.start;
  });
  for (let index = 1; index < widths.length; index += 1) {
    assert.ok(widths[index] - widths[index - 1] > 0.07);
  }
});

void test("logarithmic scrollbar navigation still reaches both ends of the movie", () => {
  for (const progress of [0, 0.5, 1]) {
    const geometry = viewportScrollbarGeometry({
      start: progress * 3590,
      span: 10,
      duration: 3600,
      minSpan: 1,
      viewportWidth: 1000,
    });
    assert.ok(
      Math.abs(geometry.value.start / geometry.scrollableFraction - progress) <
        1e-10,
    );
    assert.ok(geometry.value.start >= 0);
    assert.ok(geometry.value.end <= 1);
    if (progress === 1) {
      assert.equal(geometry.value.end, 1);
    }
  }
  const full = viewportScrollbarGeometry({
    start: 0,
    span: 3600,
    duration: 3600,
    minSpan: 1,
    viewportWidth: 1000,
  });
  assert.deepEqual(full.value, { start: 0, end: 1 });
  assert.equal(full.scrollableDuration, 0);
});

void test("button zoom keeps a visible playhead at its screen position", () => {
  const engine = new TimelineEngine({
    tracks: [],
    duration: fromSeconds(3600),
    zoomScale: 100,
    playheadTime: fromSeconds(1803),
  });
  engine.setViewportWidth(1000);
  engine.setScrollLeft(180_000);
  zoomEditorTimeline(engine, 200);
  assert.equal(engine.timeToPixel(fromSeconds(1803)), 300);
  assert.equal(engine.zoomScale, 200);
});

void test("button zoom keeps the viewport center when the playhead is offscreen", () => {
  const engine = new TimelineEngine({
    tracks: [],
    duration: fromSeconds(3600),
    zoomScale: 100,
    playheadTime: fromSeconds(0),
  });
  engine.setViewportWidth(1000);
  engine.setScrollLeft(180_000);
  zoomEditorTimeline(engine, 200);
  assert.equal(engine.timeToPixel(fromSeconds(1805)), 500);
});

void test("zoom drag precision depends on the visible span, not media length", () => {
  for (const duration of [1800, 3600, 7200]) {
    assert.deepEqual(
      viewportRangeAfterZoomDrag({
        range: { start: 900, end: 920 },
        side: "end",
        deltaPixels: -120,
        minSpan: 1,
        duration,
      }),
      { start: 900, end: 910 },
    );
  }
});

void test("each handle preserves the opposite boundary while zooming", () => {
  const input = { range: { start: 900, end: 920 }, minSpan: 1, duration: 3600 };
  assert.deepEqual(
    viewportRangeAfterZoomDrag({ ...input, side: "start", deltaPixels: 120 }),
    { start: 910, end: 920 },
  );
  assert.deepEqual(
    viewportRangeAfterZoomDrag({ ...input, side: "end", deltaPixels: 120 }),
    { start: 900, end: 940 },
  );
  assert.deepEqual(
    viewportRangeAfterZoomDrag({ ...input, side: "end", deltaPixels: 0 }),
    input.range,
  );
});

void test("small drags remain precise at subtitle scale", () => {
  const range = viewportRangeAfterZoomDrag({
    range: { start: 900, end: 902 },
    side: "end",
    deltaPixels: -1,
    minSpan: 0.5,
    duration: 7200,
  });
  assert.equal(range.start, 900);
  assert.ok(range.end > 901.98 && range.end < 902);
});

void test("zoom stays inside media bounds and respects the minimum visible span", () => {
  const input = {
    range: { start: 3590, end: 3600 },
    minSpan: 1,
    duration: 3600,
  };
  assert.deepEqual(
    viewportRangeAfterZoomDrag({ ...input, side: "end", deltaPixels: 120 }),
    { start: 3580, end: 3600 },
  );
  assert.deepEqual(
    viewportRangeAfterZoomDrag({ ...input, side: "end", deltaPixels: 10_000 }),
    { start: 0, end: 3600 },
  );
  assert.deepEqual(
    viewportRangeAfterZoomDrag({
      ...input,
      side: "start",
      deltaPixels: 10_000,
    }),
    { start: 3599, end: 3600 },
  );
});
