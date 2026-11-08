/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";

import {
  createSubtitleCueReader,
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

void test("reuses preview cues until a boundary and resets on backward seeks", () => {
  const read = createSubtitleCueReader(cues);
  const overlap = read(1);
  assert.equal(read(2.99), overlap);
  for (const time of [3, 4, 7, 1.5, 0, -1, 20, 2, NaN]) {
    assert.deepEqual(read(time), getActiveSubtitleCues(cues, time));
  }
});

void test("reuses the same paint on reverse scrubs up to each overlap boundary", () => {
  const read = createSubtitleCueReader(cues);
  const last = read(3.9);
  assert.deepEqual(last, [cues[1]]);
  assert.equal(read(3.5), last);
  assert.equal(read(3), last);
  const overlap = read(2.9);
  assert.deepEqual(overlap, [cues[0], cues[1]]);
  assert.equal(read(2.8), overlap);
  assert.equal(read(1), overlap);
  assert.deepEqual(read(0.9), [cues[0]]);
  const gap = read(12);
  assert.equal(read(5), gap);
  assert.deepEqual(read(4.9), [cues[2]]);
});
