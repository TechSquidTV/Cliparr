import assert from "node:assert/strict";
import test from "node:test";

import { resolveExportOutputDimensions } from "#/lib/export/exportTypes";
import { isVideoCrop, resolveVideoCrop, type VideoCrop } from "#/lib/videoCrop";

const crop: VideoCrop = {
  x: 0.25,
  y: 0.25,
  width: 0.5,
  height: 0.5,
  sourceAspectRatio: 16 / 9,
};
const source = { width: 1920, height: 1080 };

void test("maps one crop to the same region at different playback resolutions", () => {
  assert.deepEqual(resolveVideoCrop(crop, source), {
    left: 480,
    top: 270,
    width: 960,
    height: 540,
  });
  assert.deepEqual(resolveVideoCrop(crop, { width: 1280, height: 720 }), {
    left: 320,
    top: 180,
    width: 640,
    height: 360,
  });
  assert.deepEqual(
    resolveExportOutputDimensions(source, "original", "mp4", undefined, crop),
    { width: 960, height: 540 },
  );
  assert.deepEqual(
    resolveExportOutputDimensions(source, "720", "mp4", undefined, crop),
    { width: 1280, height: 720 },
  );
});

void test("rounds edges inside the picture and keeps tiny selections nonempty", () => {
  assert.deepEqual(
    resolveVideoCrop(
      { ...crop, x: 0.9999, y: 0.9999, width: 0.0001, height: 0.0001 },
      source,
    ),
    { left: 1919, top: 1079, width: 1, height: 1 },
  );
  const oddCrop = { ...crop, x: 0, y: 0, width: 101 / 1920, height: 99 / 1080 };
  assert.deepEqual(
    resolveExportOutputDimensions(
      source,
      "original",
      "mp4",
      undefined,
      oddCrop,
    ),
    { width: 100, height: 98 },
  );
  assert.deepEqual(
    resolveExportOutputDimensions(
      source,
      "original",
      "gif",
      undefined,
      oddCrop,
    ),
    { width: 101, height: 99 },
  );
});

void test("aligns native crop dimensions independently without shrinking the other axis", () => {
  for (const [width, height, expected] of [
    [1000, 101, { width: 1000, height: 100 }],
    [101, 1000, { width: 100, height: 1000 }],
    [1001, 101, { width: 1000, height: 100 }],
    [1, 3, { width: 2, height: 2 }],
  ] as const) {
    const region = {
      ...crop,
      x: 0,
      y: 0,
      width: width / source.width,
      height: height / source.height,
    };
    assert.deepEqual(
      resolveExportOutputDimensions(
        source,
        "original",
        "mp4",
        undefined,
        region,
      ),
      expected,
    );
  }
  const wideCrop = {
    ...crop,
    x: 0,
    y: 0,
    width: 1000 / source.width,
    height: 101 / source.height,
  };
  assert.deepEqual(
    resolveExportOutputDimensions(source, "720", "mp4", undefined, wideCrop),
    { width: 7128, height: 720 },
  );
  assert.deepEqual(
    resolveExportOutputDimensions(
      source,
      "original",
      "gif",
      undefined,
      wideCrop,
    ),
    { width: 1000, height: 101 },
  );
});

void test("keeps native full-frame copies unchanged and caps cropped GIF height", () => {
  const full = { ...crop, x: 0, y: 0, width: 1, height: 1 };
  assert.equal(resolveVideoCrop(full, source), null);
  assert.deepEqual(
    resolveExportOutputDimensions(source, "original", "mp4", undefined, full),
    source,
  );
  assert.deepEqual(
    resolveExportOutputDimensions(source, "original", "gif", undefined, crop),
    { width: 853, height: 480 },
  );
});

void test("rejects invalid or differently framed crops without blocking audio export", () => {
  for (const invalid of [
    null,
    {},
    { ...crop, x: -0.1 },
    { ...crop, width: 0 },
    { ...crop, x: 0.9 },
    { ...crop, height: NaN },
    { ...crop, sourceAspectRatio: Infinity },
  ]) {
    assert.equal(isVideoCrop(invalid), false);
  }
  assert.throws(
    () => resolveVideoCrop({ ...crop, width: 2 }, source),
    /invalid/,
  );
  assert.throws(() => resolveVideoCrop(crop, null), /Waiting/);
  assert.throws(
    () => resolveVideoCrop(crop, { width: 1080, height: 1920 }),
    /different picture shape/,
  );
  assert.equal(
    resolveExportOutputDimensions(null, "original", "mp3", undefined, crop),
    null,
  );
});
