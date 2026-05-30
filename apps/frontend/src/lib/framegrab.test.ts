/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FRAMEGRAB_IMAGE_QUALITY,
  framegrabExtensionFor,
  framegrabFormatOptionFor,
  framegrabImageFormatOptions,
  framegrabImageQualityOptions,
  framegrabMimeTypeFor,
  framegrabQualityOptionFor,
  resolveFramegrabCloneDimensions,
} from "@/lib/framegrab";

void test("exposes framegrab image format metadata", () => {
  assert.equal(DEFAULT_FRAMEGRAB_IMAGE_QUALITY, "high");
  assert.deepEqual(
    framegrabImageFormatOptions.map((option) => option.value),
    ["png", "jpg", "webp"],
  );
  assert.equal(framegrabMimeTypeFor("png"), "image/png");
  assert.equal(framegrabMimeTypeFor("jpg"), "image/jpeg");
  assert.equal(framegrabMimeTypeFor("webp"), "image/webp");
  assert.equal(framegrabExtensionFor("jpg"), ".jpg");
  assert.deepEqual(framegrabFormatOptionFor("webp"), {
    value: "webp",
    label: "WEBP",
    extension: ".webp",
    mimeType: "image/webp",
  });
});

void test("exposes framegrab quality metadata", () => {
  assert.deepEqual(
    framegrabImageQualityOptions.map((option) => option.value),
    ["high", "balanced", "compact"],
  );
  assert.deepEqual(framegrabQualityOptionFor("high"), {
    value: "high",
    label: "High",
    quality: 0.92,
  });
  assert.equal(framegrabQualityOptionFor("balanced").quality, 0.82);
  assert.equal(framegrabQualityOptionFor("compact").quality, 0.68);
});

void test("resolves framegrab clone dimensions from rendered preview size", () => {
  assert.deepEqual(
    resolveFramegrabCloneDimensions({
      sourceWidth: 1920,
      sourceHeight: 1080,
      renderedWidth: 960,
      renderedHeight: 540,
      devicePixelRatio: 2,
    }),
    {
      width: 1920,
      height: 1080,
    },
  );

  assert.deepEqual(
    resolveFramegrabCloneDimensions({
      sourceWidth: 1280,
      sourceHeight: 720,
      renderedWidth: 900,
      renderedHeight: 506.25,
      devicePixelRatio: 2,
    }),
    {
      width: 1800,
      height: 1013,
    },
  );
});

void test("falls back to source dimensions when rendered size is unavailable", () => {
  assert.deepEqual(
    resolveFramegrabCloneDimensions({
      sourceWidth: 1280.4,
      sourceHeight: 719.6,
      renderedWidth: 0,
      renderedHeight: 0,
      devicePixelRatio: 2,
    }),
    {
      width: 1280,
      height: 720,
    },
  );
});
