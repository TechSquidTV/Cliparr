/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  calibratedEstimatedVideoBitrateBps,
  exportVideoCodecPriorities,
  formatCanCopyVideoCodec,
} from "@/lib/exportEncodingPolicy";

void test("uses compatibility-first codec priorities", () => {
  assert.deepEqual(exportVideoCodecPriorities("mp4").slice(0, 2), [
    "avc",
    "hevc",
  ]);
  assert.deepEqual(exportVideoCodecPriorities("webm"), ["vp9", "vp8", "av1"]);
});

void test("derives numeric targets from dimensions, codec, and quality", () => {
  const dimensions = { width: 1920, height: 1080 };

  assert.equal(
    calibratedEstimatedVideoBitrateBps({
      format: "mp4",
      codec: "avc",
      outputDimensions: dimensions,
      quality: "balanced",
    }),
    3_000_000,
  );
  assert.equal(
    calibratedEstimatedVideoBitrateBps({
      format: "webm",
      codec: "vp9",
      outputDimensions: dimensions,
      quality: "sharp",
    }),
    3_600_000,
  );
});

void test("only permits Sharp source copying into compatible containers", () => {
  assert.equal(formatCanCopyVideoCodec("webm", "vp9"), true);
  assert.equal(formatCanCopyVideoCodec("webm", "avc"), false);
  assert.equal(formatCanCopyVideoCodec("mp4", "avc"), true);
  assert.equal(formatCanCopyVideoCodec("mkv", null), false);
});
