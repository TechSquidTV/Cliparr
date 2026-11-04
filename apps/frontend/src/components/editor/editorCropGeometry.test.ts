import assert from "node:assert/strict";
import test from "node:test";

import {
  constrainCropRectangle,
  cropRectangle,
  cropRegion,
  cropWithAspectRatio,
} from "#/components/editor/editorCropGeometry";

const bounds = { width: 320, height: 180 };
void test("clamps a fast move at each edge without changing the crop size", () => {
  const rectangle = { x: -500, y: 900, width: 120, height: 80 };
  assert.deepEqual(constrainCropRectangle(rectangle, bounds), {
    x: 0,
    y: 100,
    width: 120,
    height: 80,
  });
  assert.deepEqual(
    constrainCropRectangle({ ...rectangle, x: 900, y: -500 }, bounds),
    { x: 200, y: 0, width: 120, height: 80 },
  );
});
void test("clamps free resizing independently and locked resizing proportionally", () => {
  const anchor = { x: 60, y: 40 };
  assert.deepEqual(
    constrainCropRectangle(
      { ...anchor, width: 800, height: 200 },
      bounds,
      anchor,
    ),
    { ...anchor, width: 260, height: 140 },
  );
  assert.deepEqual(
    constrainCropRectangle(
      { ...anchor, width: 800, height: 800 },
      bounds,
      anchor,
      1,
    ),
    { ...anchor, width: 140, height: 140 },
  );
  assert.deepEqual(
    constrainCropRectangle(
      { x: -500, y: -500, width: 560, height: 540 },
      bounds,
      anchor,
    ),
    { x: 0, y: 0, width: 60, height: 40 },
  );
});
void test("keeps the fixed corner when a locked resize crosses its anchor", () => {
  const anchor = { x: 160, y: 90 };
  for (const [x, y] of [
    [-340, -410],
    [160, -410],
    [-340, 90],
    [160, 90],
  ]) {
    const result = constrainCropRectangle(
      { x, y, width: 500, height: 500 },
      bounds,
      anchor,
      1,
    );
    assert.equal(result.width, 90);
    assert.equal(result.height, 90);
    assert.equal(result.x, x < anchor.x ? 70 : 160);
    assert.equal(result.y, y < anchor.y ? 0 : 90);
  }
});
void test("normalizes coordinates and fits portrait ratios around the existing center", () => {
  const region = cropWithAspectRatio(null, bounds, 9 / 16);
  assert.ok(region);
  const rectangle = cropRectangle(region, bounds);
  assert.equal(rectangle.width / rectangle.height, 9 / 16);
  assert.equal(rectangle.x + rectangle.width / 2, 160);
  assert.equal(rectangle.y + rectangle.height / 2, 90);
  assert.deepEqual(cropRegion(rectangle, bounds), region);
  assert.equal(cropRegion({ x: 0, y: 0, ...bounds }, bounds), null);
});

void test("free side resizing keeps the opposite edge and perpendicular span fixed", () => {
  for (const [rectangle, anchor, axis, expected] of [
    [
      { x: 40, y: -100, width: 160, height: 220 },
      { x: 120, y: 120 },
      "vertical",
      { x: 40, y: 0, width: 160, height: 120 },
    ],
    [
      { x: 40, y: 30, width: 160, height: 500 },
      { x: 120, y: 30 },
      "vertical",
      { x: 40, y: 30, width: 160, height: 150 },
    ],
    [
      { x: -100, y: 30, width: 300, height: 90 },
      { x: 200, y: 75 },
      "horizontal",
      { x: 0, y: 30, width: 200, height: 90 },
    ],
    [
      { x: 40, y: 30, width: 500, height: 90 },
      { x: 40, y: 75 },
      "horizontal",
      { x: 40, y: 30, width: 280, height: 90 },
    ],
  ] as const) {
    assert.deepEqual(
      constrainCropRectangle(rectangle, bounds, anchor, null, axis),
      expected,
    );
  }
});

void test("locked side resizing clamps symmetrically around the opposite midpoint", () => {
  for (const [rectangle, anchor, axis, expected] of [
    [
      { x: -380, y: -880, width: 1000, height: 1000 },
      { x: 120, y: 120 },
      "vertical",
      { x: 60, y: 0, width: 120, height: 120 },
    ],
    [
      { x: -380, y: 30, width: 1000, height: 1000 },
      { x: 120, y: 30 },
      "vertical",
      { x: 45, y: 30, width: 150, height: 150 },
    ],
    [
      { x: -800, y: -425, width: 1000, height: 1000 },
      { x: 200, y: 75 },
      "horizontal",
      { x: 50, y: 0, width: 150, height: 150 },
    ],
    [
      { x: 40, y: -425, width: 1000, height: 1000 },
      { x: 40, y: 75 },
      "horizontal",
      { x: 40, y: 0, width: 150, height: 150 },
    ],
  ] as const) {
    assert.deepEqual(
      constrainCropRectangle(rectangle, bounds, anchor, 1, axis),
      expected,
    );
  }
  // The fixed midpoint remains anchored when a side crosses through it.
  assert.deepEqual(
    constrainCropRectangle(
      { x: 40, y: 55, width: 40, height: 40 },
      bounds,
      { x: 40, y: 75 },
      1,
      "horizontal",
    ),
    { x: 40, y: 55, width: 40, height: 40 },
  );
  assert.deepEqual(
    constrainCropRectangle(
      { x: 100, y: 30, width: 40, height: 40 },
      bounds,
      { x: 120, y: 30 },
      1,
      "vertical",
    ),
    { x: 100, y: 30, width: 40, height: 40 },
  );
});
