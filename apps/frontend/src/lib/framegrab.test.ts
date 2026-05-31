/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FRAMEGRAB_IMAGE_QUALITY,
  encodeFramegrabCanvas,
  framegrabExtensionFor,
  framegrabFormatOptionFor,
  framegrabImageFormatOptions,
  framegrabImageQualityOptions,
  framegrabMimeTypeFor,
  framegrabQualityOptionFor,
} from "@/lib/framegrab";

type ToBlobCallback = (blob: Blob | null) => void;

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

void test("encodes framegrabs with the requested MIME type and quality", async () => {
  let requestedMimeType: string | undefined;
  let requestedQuality: number | undefined;
  const canvas = {
    toBlob(
      callback: ToBlobCallback,
      mimeType?: string,
      quality?: number,
    ): void {
      requestedMimeType = mimeType;
      requestedQuality = quality;
      callback(new Blob(["frame"], { type: "image/webp" }));
    },
  } as unknown as HTMLCanvasElement;

  const blob = await encodeFramegrabCanvas(canvas, "webp", "balanced");

  assert.equal(blob.type, "image/webp");
  assert.equal(requestedMimeType, "image/webp");
  assert.equal(requestedQuality, 0.82);
});

void test("rejects browser MIME fallback during framegrab encoding", async () => {
  const canvas = {
    toBlob(callback: ToBlobCallback): void {
      callback(new Blob(["frame"], { type: "image/png" }));
    },
  } as unknown as HTMLCanvasElement;

  await assert.rejects(
    encodeFramegrabCanvas(canvas, "webp"),
    /Could not encode the frame image as image\/webp\./,
  );
});
