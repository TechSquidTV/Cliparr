/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  getActiveSubtitleCue,
  getActiveSubtitleCues,
} from "@/lib/subtitles/getActiveSubtitleCue";
import type { SubtitleCue } from "@/lib/subtitles/types";

const cues: SubtitleCue[] = [
  {
    id: "cue-1",
    startTime: 0,
    endTime: 3,
    text: "Top line",
    lines: ["Top line"],
  },
  {
    id: "cue-2",
    startTime: 1,
    endTime: 4,
    text: "Bottom line",
    lines: ["Bottom line"],
  },
  {
    id: "cue-3",
    startTime: 4,
    endTime: 5,
    text: "Next",
    lines: ["Next"],
  },
];

void test("returns all overlapping active subtitle cues", () => {
  assert.deepEqual(
    getActiveSubtitleCues(cues, 2).map((cue) => cue.id),
    ["cue-1", "cue-2"],
  );
});

void test("returns the first active subtitle cue for singular callers", () => {
  assert.deepEqual(getActiveSubtitleCue(cues, 2), cues[0]);
});

void test("keeps adjacent subtitle cues from overlapping", () => {
  assert.deepEqual(
    getActiveSubtitleCues(cues, 4).map((cue) => cue.id),
    ["cue-3"],
  );
});
