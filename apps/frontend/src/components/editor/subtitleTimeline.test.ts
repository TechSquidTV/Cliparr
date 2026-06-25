/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  applySubtitleCueTimingUpdates,
  assignSubtitleCueLanes,
  buildSubtitleCueTimingPropertyUpdate,
  buildSubtitleTimelineTrack,
  isValidSubtitleCueRange,
  isValidSubtitleTimelineActionRange,
  roundSubtitleCueTimingUpdate,
  snapSubtitleCueTimingUpdateToAdjacentCue,
  subtitleCuesInTimelineWindow,
  subtitleTimelineActionId,
  subtitleTimelineTrackToCues,
  type SubtitleTimelineCue,
} from "@/components/editor/subtitleTimeline";

function cue(
  id: string,
  startTime: number,
  endTime: number,
): SubtitleTimelineCue {
  return {
    id,
    sourceIndex: Number(id.replaceAll(/\D/g, "")) || 0,
    startTime,
    endTime,
    text: `Cue ${id}`,
    lines: [`Cue ${id}`],
  };
}

void test("places non-overlapping subtitle cues in the first lane", () => {
  const lanes = assignSubtitleCueLanes([
    cue("cue-1", 0, 1),
    cue("cue-2", 1, 2),
    cue("cue-3", 3, 4),
  ]);

  assert.equal(lanes.length, 1);
  assert.deepEqual(
    lanes[0]?.cues.map((item) => item.id),
    ["cue-1", "cue-2", "cue-3"],
  );
});

void test("creates lower subtitle lanes only while cues overlap", () => {
  const lanes = assignSubtitleCueLanes([
    cue("cue-1", 0, 4),
    cue("cue-2", 1, 2),
    cue("cue-3", 2, 3),
    cue("cue-4", 4, 5),
  ]);

  assert.equal(lanes.length, 2);
  assert.deepEqual(
    lanes[0]?.cues.map((item) => item.id),
    ["cue-1", "cue-4"],
  );
  assert.deepEqual(
    lanes[1]?.cues.map((item) => item.id),
    ["cue-2", "cue-3"],
  );
});

void test("sorts subtitle cues before assigning lanes", () => {
  const lanes = assignSubtitleCueLanes([
    cue("cue-3", 3, 4),
    cue("cue-1", 0, 2),
    cue("cue-2", 1, 3),
  ]);

  assert.deepEqual(
    lanes.map((lane) => lane.cues.map((item) => item.id)),
    [["cue-1", "cue-3"], ["cue-2"]],
  );
});

void test("filters subtitle cues to the projected timeline window", () => {
  assert.deepEqual(
    subtitleCuesInTimelineWindow({
      cues: [
        cue("before", 0, 1),
        cue("touching-start", 1, 2),
        cue("inside", 3, 4),
        cue("touching-end", 5, 6),
        cue("after", 7, 8),
      ],
      startTime: 2,
      endTime: 5,
    }).map((item) => item.id),
    ["touching-start", "inside", "touching-end"],
  );
});

void test("updates subtitle cue timing without changing unrelated cues", () => {
  const track = buildSubtitleTimelineTrack({
    trackKey: "stream:1",
    label: "English",
    cues: [
      {
        id: "a",
        startTime: 0,
        endTime: 1,
        text: "Hello",
        lines: ["Hello"],
      },
      {
        id: "b",
        startTime: 2,
        endTime: 3,
        text: "World",
        lines: ["World"],
      },
    ],
  });

  const next = applySubtitleCueTimingUpdates({
    track,
    duration: 10,
    updates: [{ cueId: "stream:1:cue:0", startTime: 0.5, endTime: 1.5 }],
  });

  assert.notEqual(next, track);
  assert.deepEqual(
    next?.cues.map((item) => [item.id, item.startTime, item.endTime]),
    [
      ["stream:1:cue:0", 0.5, 1.5],
      ["stream:1:cue:1", 2, 3],
    ],
  );
});

void test("rounds subtitle cue timing updates to timeline precision", () => {
  assert.deepEqual(
    roundSubtitleCueTimingUpdate({
      cueId: "cue-1",
      startTime: 1.234,
      endTime: 5.678,
    }),
    {
      cueId: "cue-1",
      startTime: 1.23,
      endTime: 5.68,
    },
  );
});

void test("snaps moved subtitle cues adjacent to nearby cue boundaries", () => {
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
        startTime: 2.02,
        endTime: 3.02,
        text: "Second",
        lines: ["Second"],
      },
    ],
  });

  const snappedUpdate = snapSubtitleCueTimingUpdateToAdjacentCue({
    track,
    duration: 10,
    thresholdSeconds: 0.1,
    mode: "move",
    update: {
      cueId: "stream:1:cue:1",
      startTime: 1.04,
      endTime: 2.04,
    },
  });

  assert.deepEqual(snappedUpdate, {
    cueId: "stream:1:cue:1",
    startTime: 1,
    endTime: 2,
  });

  const updatedTrack = applySubtitleCueTimingUpdates({
    track,
    duration: 10,
    updates: [snappedUpdate],
  });

  assert.deepEqual(
    assignSubtitleCueLanes(updatedTrack?.cues ?? []).map((lane) =>
      lane.cues.map((item) => item.id),
    ),
    [["stream:1:cue:0", "stream:1:cue:1"]],
  );
});

void test("snaps only the resized subtitle cue boundary", () => {
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
        startTime: 1.5,
        endTime: 2,
        text: "Second",
        lines: ["Second"],
      },
    ],
  });

  assert.deepEqual(
    snapSubtitleCueTimingUpdateToAdjacentCue({
      track,
      duration: 10,
      thresholdSeconds: 0.1,
      mode: "resize-right",
      update: {
        cueId: "stream:1:cue:0",
        startTime: 0,
        endTime: 1.47,
      },
    }),
    {
      cueId: "stream:1:cue:0",
      startTime: 0,
      endTime: 1.5,
    },
  );
});

void test("does not snap subtitle cues outside the snap threshold", () => {
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

  assert.deepEqual(
    snapSubtitleCueTimingUpdateToAdjacentCue({
      track,
      duration: 10,
      thresholdSeconds: 0.1,
      mode: "move",
      update: {
        cueId: "stream:1:cue:1",
        startTime: 1.2,
        endTime: 2.2,
      },
    }),
    {
      cueId: "stream:1:cue:1",
      startTime: 1.2,
      endTime: 2.2,
    },
  );
});

void test("rejects invalid subtitle cue timing updates", () => {
  const track = buildSubtitleTimelineTrack({
    trackKey: "stream:1",
    label: "English",
    cues: [
      {
        startTime: 1,
        endTime: 2,
        text: "Hello",
        lines: ["Hello"],
      },
    ],
  });

  assert.equal(
    applySubtitleCueTimingUpdates({
      track,
      duration: 10,
      updates: [{ cueId: "stream:1:cue:0", startTime: 2, endTime: 2 }],
    }),
    track,
  );
  assert.equal(
    applySubtitleCueTimingUpdates({
      track,
      duration: 10,
      updates: [{ cueId: "stream:1:cue:0", startTime: -1, endTime: 2 }],
    }),
    track,
  );
  assert.equal(
    applySubtitleCueTimingUpdates({
      track,
      duration: 10,
      updates: [{ cueId: "stream:1:cue:0", startTime: 1, endTime: 11 }],
    }),
    track,
  );
});

void test("builds subtitle cue timing updates from property edits", () => {
  const item = cue("cue-1", 1, 3);

  assert.deepEqual(
    buildSubtitleCueTimingPropertyUpdate({
      cue: item,
      property: "start",
      value: 1.234,
      duration: 10,
    }),
    {
      cueId: "cue-1",
      startTime: 1.23,
      endTime: 3,
    },
  );
  assert.deepEqual(
    buildSubtitleCueTimingPropertyUpdate({
      cue: item,
      property: "end",
      value: 4.567,
      duration: 10,
    }),
    {
      cueId: "cue-1",
      startTime: 1,
      endTime: 4.57,
    },
  );
  assert.deepEqual(
    buildSubtitleCueTimingPropertyUpdate({
      cue: item,
      property: "duration",
      value: 2.345,
      duration: 10,
    }),
    {
      cueId: "cue-1",
      startTime: 1,
      endTime: 3.35,
    },
  );
});

void test("rejects invalid subtitle cue timing property edits", () => {
  const item = cue("cue-1", 1, 3);

  assert.equal(
    buildSubtitleCueTimingPropertyUpdate({
      cue: item,
      property: "start",
      value: 3,
      duration: 10,
    }),
    null,
  );
  assert.equal(
    buildSubtitleCueTimingPropertyUpdate({
      cue: item,
      property: "end",
      value: 1,
      duration: 10,
    }),
    null,
  );
  assert.equal(
    buildSubtitleCueTimingPropertyUpdate({
      cue: item,
      property: "duration",
      value: 20,
      duration: 10,
    }),
    null,
  );
});

void test("validates subtitle cue ranges independently from clip minimum length", () => {
  assert.equal(
    isValidSubtitleCueRange({ startTime: 1, endTime: 1.01, duration: 2 }),
    true,
  );
  assert.equal(
    isValidSubtitleCueRange({ startTime: 1, endTime: 1, duration: 2 }),
    false,
  );
});

void test("validates only subtitle timeline action ranges", () => {
  assert.equal(
    isValidSubtitleTimelineActionRange({
      actionId: subtitleTimelineActionId("cue-1"),
      startTime: 1,
      endTime: 1.01,
      duration: 2,
    }),
    true,
  );
  assert.equal(
    isValidSubtitleTimelineActionRange({
      actionId: "selected-clip",
      startTime: 1,
      endTime: 1.01,
      duration: 2,
    }),
    false,
  );
});

void test("converts subtitle timeline tracks back to sorted subtitle cues", () => {
  const track = buildSubtitleTimelineTrack({
    trackKey: "stream:1",
    label: "English",
    cues: [
      { startTime: 2, endTime: 3, text: "Second", lines: ["Second"] },
      {
        id: "first",
        startTime: 0,
        endTime: 1,
        text: "First",
        lines: ["First"],
      },
    ],
  });

  assert.deepEqual(
    subtitleTimelineTrackToCues(track).map((item) => ({
      id: item.id,
      startTime: item.startTime,
      text: item.text,
    })),
    [
      { id: "first", startTime: 0, text: "First" },
      { id: "stream:1:cue:0", startTime: 2, text: "Second" },
    ],
  );
});
