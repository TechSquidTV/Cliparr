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
