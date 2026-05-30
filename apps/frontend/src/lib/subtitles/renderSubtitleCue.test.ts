/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { resolveSubtitleLayerBounds } from "@/lib/subtitles/renderSubtitleCue";

void test("resolves subtitle supersampling bounds with stroke and shadow padding", () => {
  assert.deepEqual(
    resolveSubtitleLayerBounds({
      canvasWidth: 1920,
      canvasHeight: 1080,
      centerX: 960,
      startY: 900,
      maxLineWidth: 840,
      totalHeight: 96,
      strokeWidth: 6,
      shadowBlur: 8,
      shadowOffsetY: 5,
    }),
    {
      left: 527,
      top: 887,
      width: 866,
      height: 127,
    },
  );
});

void test("clamps subtitle supersampling bounds to the target canvas", () => {
  assert.deepEqual(
    resolveSubtitleLayerBounds({
      canvasWidth: 640,
      canvasHeight: 360,
      centerX: 320,
      startY: 330,
      maxLineWidth: 760,
      totalHeight: 80,
      strokeWidth: 4,
      shadowBlur: 12,
      shadowOffsetY: 8,
    }),
    {
      left: 0,
      top: 314,
      width: 640,
      height: 46,
    },
  );
});
