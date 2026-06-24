/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  renderSubtitleCue,
  renderSubtitleCues,
  resolveSubtitleLayerBounds,
} from "@/lib/subtitles/renderSubtitleCue";
import type { SubtitleStyleSettings } from "@/lib/subtitles/types";

interface FakeCanvas {
  width: number;
  height: number;
  getContext: () => FakeCanvasContext;
}

interface FakeCanvasContext {
  canvas: { ownerDocument: { createElement: () => FakeCanvas } };
  drawImageCalls: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  fillStyle: string;
  font: string;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
  lineJoin: string;
  lineWidth: number;
  miterLimit: number;
  shadowBlur: number;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
  strokeStyle: string;
  textAlign: string;
  textBaseline: string;
  save: () => void;
  restore: () => void;
  measureText: (text: string) => { width: number };
  drawImage: (...parameters: unknown[]) => undefined;
  fillText: () => undefined;
  strokeText: () => undefined;
}

function createFakeCanvasContext(ownerDocument: {
  createElement: () => FakeCanvas;
}): FakeCanvasContext {
  const stateStack: string[] = [];
  const context: FakeCanvasContext = {
    canvas: { ownerDocument },
    drawImageCalls: [],
    fillStyle: "",
    font: "10px initial",
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    lineJoin: "miter",
    lineWidth: 1,
    miterLimit: 10,
    shadowBlur: 0,
    shadowColor: "",
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    strokeStyle: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    save() {
      stateStack.push(context.font);
    },
    restore() {
      const font = stateStack.pop();
      if (font) {
        context.font = font;
      }
    },
    measureText(text) {
      return { width: text.length * 12 };
    },
    drawImage(...parameters) {
      const [, x, y, width, height] = parameters;
      if (
        typeof x === "number" &&
        typeof y === "number" &&
        typeof width === "number" &&
        typeof height === "number"
      ) {
        context.drawImageCalls.push({ x, y, width, height });
      }
      return;
    },
    fillText() {
      return;
    },
    strokeText() {
      return;
    },
  };

  return context;
}

function createFakeCanvas(ownerDocument?: {
  createElement: () => FakeCanvas;
}): FakeCanvas {
  const resolvedOwnerDocument = ownerDocument ?? {
    createElement: () => createFakeCanvas(),
  };

  return {
    width: 0,
    height: 0,
    getContext() {
      return createFakeCanvasContext(resolvedOwnerDocument);
    },
  };
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
  const ownerDocument = {
    createElement: () => createFakeCanvas(ownerDocument),
  };
  const context = createFakeCanvasContext(ownerDocument);
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

void test("rendering multiple subtitle cues composites separate cue layers at the same anchor", () => {
  const ownerDocument = {
    createElement: () => createFakeCanvas(ownerDocument),
  };
  const context = createFakeCanvasContext(ownerDocument);

  renderSubtitleCues(
    context as unknown as CanvasRenderingContext2D,
    [
      {
        id: "overlap-cue-1",
        startTime: 0,
        endTime: 2,
        text: "Bottom cue",
        lines: ["Bottom cue"],
      },
      {
        id: "overlap-cue-2",
        startTime: 0,
        endTime: 2,
        text: "Top cue",
        lines: ["Top cue"],
      },
    ],
    subtitleStyle,
    1920,
    1080,
  );

  assert.equal(context.drawImageCalls.length, 2);
  assert.equal(context.drawImageCalls[0]!.y, context.drawImageCalls[1]!.y);
});
