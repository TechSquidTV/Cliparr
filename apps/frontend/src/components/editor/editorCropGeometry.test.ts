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
