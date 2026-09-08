import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TimelineEngine,
  fromSeconds,
  toSeconds,
} from "@techsquidtv/canvas-timeline";
import { createEditorHistory } from "@/components/editor/editorHistory";
import {
  subtitleCuesFromTimeline,
  synchronizeEditorTimelineSubtitles,
} from "@/components/editor/editorTimelineEngine";
import { resolveEditorShortcutCommand } from "@/components/editor/editorShortcutCommands";

function createEngine() {
  const engine = new TimelineEngine({
    tracks: [],
    duration: fromSeconds(60),
    inPoint: fromSeconds(0),
    outPoint: fromSeconds(10),
  });
  synchronizeEditorTimelineSubtitles(engine, {
    cues: [
      {
        id: "cue-1",
        startTime: 1,
        endTime: 2,
        text: "Original",
        lines: ["Original"],
      },
    ],
  });
  return engine;
}

void test("undoes range and subtitle edits in chronological order", () => {
  const engine = createEngine();
  const history = createEditorHistory(engine);
  engine.setInPoint(fromSeconds(5));
  const clip = engine.getState().tracks[0]?.clips[0];
  assert.ok(clip);
  engine.updateClipProperties(clip.id, { label: "Edited" });
  history.undo();
  assert.equal(
    subtitleCuesFromTimeline(engine.getState().tracks)[0]?.text,
    "Original",
  );
  assert.equal(toSeconds(engine.getState().inPoint!), 5);
  history.undo();
  assert.equal(toSeconds(engine.getState().inPoint!), 0);
  assert.equal(history.getSnapshot().canUndo, false);
  history.redo();
  history.redo();
  assert.equal(toSeconds(engine.getState().inPoint!), 5);
  assert.equal(
    subtitleCuesFromTimeline(engine.getState().tracks)[0]?.text,
    "Edited",
  );
  assert.equal(history.getSnapshot().canRedo, false);
  history.dispose();
});

void test("groups a range drag and clears redo after a new edit", () => {
  const engine = createEngine();
  const history = createEditorHistory(engine);
  history.beginRangeGesture();
  for (const value of [1, 2, 3, 4]) {
    engine.setInPoint(fromSeconds(value));
  }
  history.endRangeGesture();
  history.undo();
  assert.equal(toSeconds(engine.getState().inPoint!), 0);
  assert.equal(history.getSnapshot().canUndo, false);
  engine.setOutPoint(fromSeconds(20));
  assert.equal(history.getSnapshot().canRedo, false);
  history.undo();
  assert.equal(toSeconds(engine.getState().outPoint!), 10);
  history.dispose();
});

void test("playback and zoom do not become undoable edits", () => {
  const engine = createEngine();
  const history = createEditorHistory(engine);
  engine.setTime(fromSeconds(3));
  engine.setZoomScale(100);
  assert.equal(history.getSnapshot().canUndo, false);
  history.dispose();
  engine.setInPoint(fromSeconds(2));
  assert.equal(history.getSnapshot().canUndo, false);
});

void test("resolves platform undo and redo without consuming unrelated modifiers", () => {
  assert.equal(
    resolveEditorShortcutCommand({ code: "KeyZ", ctrlKey: true }),
    "undo",
  );
  assert.equal(
    resolveEditorShortcutCommand({
      code: "KeyZ",
      metaKey: true,
      shiftKey: true,
    }),
    "redo",
  );
  assert.equal(
    resolveEditorShortcutCommand({ code: "KeyY", ctrlKey: true }),
    "redo",
  );
  assert.equal(
    resolveEditorShortcutCommand({ code: "KeyZ", ctrlKey: true, altKey: true }),
    null,
  );
});
