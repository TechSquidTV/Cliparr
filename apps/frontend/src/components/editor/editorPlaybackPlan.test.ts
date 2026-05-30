/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { resolvePreviewPlaybackPlan } from "./editorPlaybackPlan";

void test("snaps to the selection start when the playhead is close", () => {
  assert.deepEqual(
    resolvePreviewPlaybackPlan({
      currentTime: 9.2,
      clipStart: 10,
      clipEnd: 20,
      duration: 60,
    }),
    {
      mode: "selection",
      startTime: 10,
      stopTime: 20,
      resetTime: 10,
    },
  );
});

void test("plays from inside the selection without snapping", () => {
  assert.deepEqual(
    resolvePreviewPlaybackPlan({
      currentTime: 14,
      clipStart: 10,
      clipEnd: 20,
      duration: 60,
    }),
    {
      mode: "selection",
      startTime: 14,
      stopTime: 20,
      resetTime: 10,
    },
  );
});

void test("plays source preview from a playhead outside the selection", () => {
  assert.deepEqual(
    resolvePreviewPlaybackPlan({
      currentTime: 35,
      clipStart: 10,
      clipEnd: 20,
      duration: 60,
    }),
    {
      mode: "source",
      startTime: 35,
      stopTime: 60,
      resetTime: null,
    },
  );
});

void test("keeps distant pre-selection preview at the playhead", () => {
  assert.deepEqual(
    resolvePreviewPlaybackPlan({
      currentTime: 2,
      clipStart: 10,
      clipEnd: 20,
      duration: 60,
    }),
    {
      mode: "source",
      startTime: 2,
      stopTime: 60,
      resetTime: null,
    },
  );
});
