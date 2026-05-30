/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  FRAMEGRAB_IMAGE_QUALITY,
  framegrabExtensionFor,
  framegrabFormatOptionFor,
  framegrabImageFormatOptions,
  framegrabMimeTypeFor,
} from "@/lib/framegrab";

void test("exposes framegrab image format metadata", () => {
  assert.equal(FRAMEGRAB_IMAGE_QUALITY, 0.92);
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
