/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  renderSubtitleCue,
  resolveSubtitleLayerBounds,
} from "@/lib/subtitles/renderSubtitleCue";
import type { SubtitleStyleSettings } from "@/lib/subtitles/types";

class FakeCanvasContext {
  canvas: { ownerDocument: { createElement: () => FakeCanvas } };
  fillStyle = "";
  font = "10px initial";
  imageSmoothingEnabled = false;
  imageSmoothingQuality = "low";
  lineJoin = "miter";
  lineWidth = 1;
  miterLimit = 10;
  shadowBlur = 0;
  shadowColor = "";
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  strokeStyle = "";
  textAlign = "start";
  textBaseline = "alphabetic";
  private stateStack: string[] = [];

  constructor(ownerDocument: { createElement: () => FakeCanvas }) {
    this.canvas = { ownerDocument };
  }

  save() {
    this.stateStack.push(this.font);
  }

  restore() {
    const font = this.stateStack.pop();
    if (font) {
      this.font = font;
    }
  }

  measureText(text: string) {
    return { width: text.length * 12 };
  }

  drawImage() {
    return undefined;
  }

  fillText() {
    return undefined;
  }

  strokeText() {
    return undefined;
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  private ownerDocument: { createElement: () => FakeCanvas };

  constructor(ownerDocument?: { createElement: () => FakeCanvas }) {
    this.ownerDocument = ownerDocument ?? {
      createElement: () => new FakeCanvas(),
    };
  }

  getContext() {
    return new FakeCanvasContext(this.ownerDocument);
  }
}

const subtitleStyle: SubtitleStyleSettings = {
  fontFamily: "Inter, sans-serif",
  fontSize: 48,
  fontColor: "#ffffff",
  lineHeight: 1.2,
  strokeWidth: 6,
  strokeColor: "#000000",
  shadowBlur: 8,
  shadowColor: "rgba(0, 0, 0, 0.7)",
  shadowOffsetY: 4,
  bottomMargin: 96,
};

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

void test("rendering subtitles preserves the caller canvas font", () => {
  const ownerDocument = { createElement: () => new FakeCanvas(ownerDocument) };
  const context = new FakeCanvasContext(ownerDocument);
  context.font = "16px caller";

  renderSubtitleCue(
    context as unknown as CanvasRenderingContext2D,
    {
      id: "cue-1",
      startTime: 0,
      endTime: 2,
      text: "Hello there",
      lines: ["Hello there"],
    },
    subtitleStyle,
    1920,
    1080,
  );

  assert.equal(context.font, "16px caller");
});
