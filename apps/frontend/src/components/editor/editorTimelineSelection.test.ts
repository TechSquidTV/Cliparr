/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultEditorTimelineSelection,
  editorTimelineSelectionForActionId,
  normalizeEditorTimelineSelection,
  resolveSelectedSubtitleCue,
} from "@/components/editor/editorTimelineSelection";
import {
  buildSubtitleTimelineTrack,
  subtitleTimelineActionId,
} from "@/components/editor/subtitleTimeline";

const track = buildSubtitleTimelineTrack({
  trackKey: "stream:1",
  label: "English",
  cues: [
    {
      startTime: 0,
      endTime: 1,
      text: "First",
      lines: ["First"],
    },
    {
      startTime: 2,
      endTime: 3,
      text: "Second",
      lines: ["Second"],
    },
  ],
});

void test("defaults timeline selection to the clip", () => {
  assert.deepEqual(defaultEditorTimelineSelection(), { kind: "clip" });
});

void test("resolves timeline selection from selectable action ids", () => {
  assert.deepEqual(editorTimelineSelectionForActionId("selected-clip"), {
    kind: "clip",
  });
  assert.deepEqual(
    editorTimelineSelectionForActionId(
      subtitleTimelineActionId("stream:1:cue:0"),
    ),
    {
      kind: "subtitle-cue",
      cueId: "stream:1:cue:0",
    },
  );
  assert.equal(editorTimelineSelectionForActionId("full-video"), null);
});

void test("preserves selected subtitle cues while present", () => {
  const selection = { kind: "subtitle-cue" as const, cueId: "stream:1:cue:1" };

  assert.deepEqual(
    normalizeEditorTimelineSelection({
      selection,
      subtitleTimelineTrack: track,
    }),
    selection,
  );
  assert.equal(resolveSelectedSubtitleCue(track, selection)?.text, "Second");
});

void test("falls back to clip when selected subtitle cue is missing", () => {
  assert.deepEqual(
    normalizeEditorTimelineSelection({
      selection: { kind: "subtitle-cue", cueId: "missing" },
      subtitleTimelineTrack: track,
    }),
    { kind: "clip" },
  );
});

void test("falls back to clip when subtitle track is unavailable", () => {
  assert.deepEqual(
    normalizeEditorTimelineSelection({
      selection: { kind: "subtitle-cue", cueId: "stream:1:cue:0" },
      subtitleTimelineTrack: null,
    }),
    { kind: "clip" },
  );
});
