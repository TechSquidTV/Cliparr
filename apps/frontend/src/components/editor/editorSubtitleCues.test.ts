/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  SUBTITLE_LOADING_ACTION_ID,
  buildSubtitleTimelineActions,
  clampSubtitleCueRange,
  normalizeEditableSubtitleCues,
  subtitleCueActionId,
  subtitleCueIdFromActionId,
  subtitleCueTextToLines,
  updateEditableSubtitleCueRanges,
  updateEditableSubtitleCueText,
} from "@/components/editor/editorSubtitleCues";
import type { SubtitleCue } from "@/lib/subtitles/types";

const importedCues = [
  {
    id: "1",
    startTime: 2.004,
    endTime: 4.006,
    text: "Hello\r\nworld",
    lines: ["Hello", "world"],
  },
  {
    startTime: 5,
    endTime: 6,
    text: "Second cue",
    lines: ["Second cue"],
  },
] satisfies SubtitleCue[];

void test("normalizes imported subtitles into stable editable cues", () => {
  const cues = normalizeEditableSubtitleCues(importedCues);

  assert.equal(cues.length, 2);
  assert.equal(cues[0]?.id, "cue-1-1-2.00-4.01");
  assert.equal(cues[0]?.startTime, 2);
  assert.equal(cues[0]?.endTime, 4.01);
  assert.equal(cues[0]?.text, "Hello\nworld");
  assert.deepEqual(cues[0]?.lines, ["Hello", "world"]);
  assert.equal(cues[1]?.id, "cue-2-cue-5.00-6.00");
});

void test("derives visible subtitle lines from edited text", () => {
  assert.deepEqual(subtitleCueTextToLines("  Hello  \n\n world "), [
    "Hello",
    "world",
  ]);
  assert.deepEqual(subtitleCueTextToLines("   \n"), []);
});

void test("updates cue text while preserving timing and id", () => {
  const cues = normalizeEditableSubtitleCues(importedCues);
  const updated = updateEditableSubtitleCueText(
    cues,
    cues[0]?.id ?? "",
    "Edited\r\n\nsubtitle",
  );

  assert.notEqual(updated, cues);
  assert.equal(updated[0]?.id, cues[0]?.id);
  assert.equal(updated[0]?.startTime, cues[0]?.startTime);
  assert.equal(updated[0]?.text, "Edited\n\nsubtitle");
  assert.deepEqual(updated[0]?.lines, ["Edited", "subtitle"]);
});

void test("clamps subtitle cue timing to media duration and minimum length", () => {
  assert.deepEqual(
    clampSubtitleCueRange({
      startTime: -1,
      endTime: 0.02,
      duration: 10,
    }),
    {
      startTime: 0,
      endTime: 0.1,
    },
  );

  assert.deepEqual(
    clampSubtitleCueRange({
      startTime: 9.98,
      endTime: 12,
      duration: 10,
    }),
    {
      startTime: 9.9,
      endTime: 10,
    },
  );
});

void test("updates cue timing from timeline actions and keeps cues sorted", () => {
  const cues = normalizeEditableSubtitleCues(importedCues);
  const updated = updateEditableSubtitleCueRanges(
    cues,
    [
      {
        cueId: cues[1]?.id ?? "",
        startTime: 0.5,
        endTime: 1.5,
      },
    ],
    10,
  );

  assert.equal(updated[0]?.id, cues[1]?.id);
  assert.equal(updated[0]?.startTime, 0.5);
  assert.equal(updated[0]?.endTime, 1.5);
  assert.equal(updated[1]?.id, cues[0]?.id);
});

void test("builds subtitle timeline actions with selection and loading states", () => {
  const cues = normalizeEditableSubtitleCues(importedCues);
  const actions = buildSubtitleTimelineActions({
    cues,
    duration: 10,
    selectedCueId: cues[0]?.id ?? null,
    loading: false,
  });

  assert.equal(actions[0]?.id, subtitleCueActionId(cues[0]?.id ?? ""));
  assert.equal(subtitleCueIdFromActionId(actions[0]?.id ?? ""), cues[0]?.id);
  assert.equal(actions[0]?.effectId, "subtitle");
  assert.equal(actions[0]?.selected, true);
  assert.equal(actions[1]?.selected, false);

  const loadingActions = buildSubtitleTimelineActions({
    cues: [],
    duration: 10,
    selectedCueId: null,
    loading: true,
  });
  assert.deepEqual(loadingActions, [
    {
      id: SUBTITLE_LOADING_ACTION_ID,
      start: 0,
      end: 10,
      effectId: "subtitle-placeholder",
      flexible: false,
      movable: false,
      minStart: 0,
      maxEnd: 10,
    },
  ]);
});
