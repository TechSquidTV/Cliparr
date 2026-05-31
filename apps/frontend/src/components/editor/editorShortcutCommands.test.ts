/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_EDITOR_FRAME_STEP_SECONDS,
  resolveEditorShortcutCommand,
  resolveRelativeSeekTime,
  frameStepSecondsFromFrameRate,
} from "@/components/editor/editorShortcutCommands";

void test("resolves playback and mark shortcuts", () => {
  assert.equal(resolveEditorShortcutCommand({ code: "Space" }), "toggle-play");
  assert.equal(
    resolveEditorShortcutCommand({ code: "Space", repeat: true }),
    null,
  );
  assert.equal(resolveEditorShortcutCommand({ code: "KeyI" }), "mark-in");
  assert.equal(resolveEditorShortcutCommand({ code: "KeyO" }), "mark-out");
  assert.equal(
    resolveEditorShortcutCommand({ code: "BracketLeft" }),
    "mark-in",
  );
  assert.equal(
    resolveEditorShortcutCommand({ code: "BracketRight" }),
    "mark-out",
  );
});

void test("resolves jump, seek, frame, and zoom shortcuts", () => {
  assert.equal(
    resolveEditorShortcutCommand({ code: "KeyI", shiftKey: true }),
    "jump-to-in",
  );
  assert.equal(
    resolveEditorShortcutCommand({ code: "KeyO", shiftKey: true }),
    "jump-to-out",
  );
  assert.equal(
    resolveEditorShortcutCommand({ code: "ArrowLeft" }),
    "seek-backward-large",
  );
  assert.equal(
    resolveEditorShortcutCommand({ code: "ArrowRight", shiftKey: true }),
    "seek-forward-small",
  );
  assert.equal(
    resolveEditorShortcutCommand({ code: "PageUp" }),
    "step-frame-backward",
  );
  assert.equal(
    resolveEditorShortcutCommand({ code: "PageDown" }),
    "step-frame-forward",
  );
  assert.equal(resolveEditorShortcutCommand({ code: "Minus" }), "zoom-out");
  assert.equal(resolveEditorShortcutCommand({ code: "Equal" }), "zoom-in");
});

void test("resolves premiere frame-step aliases when K is held", () => {
  const pressedCodes = new Set(["KeyK"]);

  assert.equal(
    resolveEditorShortcutCommand({ code: "KeyJ", pressedCodes }),
    "step-frame-backward",
  );
  assert.equal(
    resolveEditorShortcutCommand({ code: "KeyL", pressedCodes }),
    "step-frame-forward",
  );
  assert.equal(resolveEditorShortcutCommand({ code: "KeyJ" }), null);
});

void test("ignores shortcuts with browser and system modifiers", () => {
  assert.equal(
    resolveEditorShortcutCommand({ code: "KeyI", metaKey: true }),
    null,
  );
  assert.equal(
    resolveEditorShortcutCommand({ code: "KeyI", ctrlKey: true }),
    null,
  );
  assert.equal(
    resolveEditorShortcutCommand({ code: "KeyI", altKey: true }),
    null,
  );
});

void test("clamps relative editor seeks to the media duration", () => {
  assert.equal(
    resolveRelativeSeekTime({
      currentTime: 20,
      deltaSeconds: 30,
      duration: 40,
    }),
    40,
  );
  assert.equal(
    resolveRelativeSeekTime({
      currentTime: 4,
      deltaSeconds: -5,
      duration: 40,
    }),
    0,
  );
  assert.equal(
    resolveRelativeSeekTime({
      currentTime: 10,
      deltaSeconds: 5,
      duration: 40,
    }),
    15,
  );
});

void test("resolves frame-step seconds from detected frame rate", () => {
  assert.equal(frameStepSecondsFromFrameRate(25), 0.04);
  assert.equal(
    frameStepSecondsFromFrameRate(0),
    DEFAULT_EDITOR_FRAME_STEP_SECONDS,
  );
  assert.equal(
    frameStepSecondsFromFrameRate(null),
    DEFAULT_EDITOR_FRAME_STEP_SECONDS,
  );
});
