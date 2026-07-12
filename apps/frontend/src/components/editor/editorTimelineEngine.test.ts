import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fromSeconds, toSeconds } from "@techsquidtv/canvas-timeline";
import {
  EDITOR_MEDIA_CLIP_ID,
  EDITOR_MEDIA_TRACK_NAME,
  EDITOR_MEDIA_TRACK_ID,
  EDITOR_SUBTITLE_TRACK_NAME,
  EDITOR_SUBTITLE_TRACK_ID,
  createEditorTimelineEngine,
  subtitleCuesFromTimeline,
  synchronizeEditorTimelineMedia,
  synchronizeEditorTimelineSubtitles,
  timelineScrollLeftForCenteredTime,
} from "@/components/editor/editorTimelineEngine";
import type { EditorSession } from "@/lib/editorMedia";

function createSession(overrides: Partial<EditorSession> = {}): EditorSession {
  return {
    id: "session-1",
    source: { id: "local", name: "Local", providerId: "local" },
    title: "Example",
    type: "video",
    duration: 20,
    initialPlayheadSeconds: 5,
    playerTitle: "Example",
    playerState: "ready",
    local: true,
    ...overrides,
  };
}

void describe("editor timeline engine", () => {
  void it("centers a time within the available horizontal scroll range", () => {
    assert.equal(
      timelineScrollLeftForCenteredTime({
        maxScrollLeft: 2000,
        timeSeconds: 10,
        viewportWidth: 300,
        zoomScale: 100,
      }),
      850,
    );
    assert.equal(
      timelineScrollLeftForCenteredTime({
        maxScrollLeft: 2000,
        timeSeconds: 1,
        viewportWidth: 300,
        zoomScale: 100,
      }),
      0,
    );
    assert.equal(
      timelineScrollLeftForCenteredTime({
        maxScrollLeft: 500,
        timeSeconds: 10,
        viewportWidth: 300,
        zoomScale: 100,
      }),
      500,
    );
  });

  void it("owns the single media track, subtitle scaffold, playhead, and export range", () => {
    const engine = createEditorTimelineEngine(createSession());
    const state = engine.getState();

    assert.deepEqual(
      state.tracks.map((track) => track.id),
      [EDITOR_MEDIA_TRACK_ID, EDITOR_SUBTITLE_TRACK_ID],
    );
    assert.equal(state.tracks[0]?.locked, true);
    assert.equal(state.tracks[0]?.clips[0]?.id, EDITOR_MEDIA_CLIP_ID);
    assert.equal(state.tracks[0]?.clips[0]?.label, "Example");
    assert.equal(state.tracks[0]?.name, EDITOR_MEDIA_TRACK_NAME);
    assert.equal(state.tracks[1]?.name, EDITOR_SUBTITLE_TRACK_NAME);
    assert.equal(state.tracks[1]?.clips.length, 0);
    assert.equal(toSeconds(state.playheadTime), 5);
    assert.equal(toSeconds(state.inPoint!), 5);
    assert.equal(toSeconds(state.outPoint!), 15);
  });

  void it("normalizes discovered duration and source timestamps into engine state", () => {
    const engine = createEditorTimelineEngine(
      createSession({ duration: 0, initialPlayheadSeconds: 12 }),
    );

    synchronizeEditorTimelineMedia(engine, {
      duration: 30,
      sourceStart: 1_700_000_000,
      initialDuration: 0,
      initialPlayheadSeconds: 12,
    });

    const state = engine.getState();
    const mediaClip = state.tracks[0]?.clips[0];
    assert.equal(toSeconds(state.duration!), 30);
    assert.equal(toSeconds(mediaClip!.timelineEnd), 30);
    assert.equal(toSeconds(mediaClip!.sourceStart), 1_700_000_000);
    assert.equal(toSeconds(state.playheadTime), 12);
    assert.equal(toSeconds(state.inPoint!), 12);
    assert.equal(toSeconds(state.outPoint!), 22);
    assert.equal(state.zoomScale, 74);
  });

  void it("preserves a valid engine-owned range when media metadata is refined", () => {
    const engine = createEditorTimelineEngine(createSession());

    synchronizeEditorTimelineMedia(engine, {
      duration: 25,
      sourceStart: 0,
      initialDuration: 20,
      initialPlayheadSeconds: 5,
    });

    const state = engine.getState();
    assert.equal(toSeconds(state.inPoint!), 5);
    assert.equal(toSeconds(state.outPoint!), 15);
  });

  void it("preserves cleared engine-owned points when media metadata is refined", () => {
    const engine = createEditorTimelineEngine(createSession());
    engine.setInPoint(undefined);
    engine.setOutPoint(undefined);

    synchronizeEditorTimelineMedia(engine, {
      duration: 25,
      sourceStart: 0,
      initialDuration: 20,
      initialPlayheadSeconds: 5,
    });

    const state = engine.getState();
    assert.equal(state.inPoint, undefined);
    assert.equal(state.outPoint, undefined);
  });

  void it("stores parsed subtitle cues as engine-owned subtitle clips", () => {
    const engine = createEditorTimelineEngine(createSession());

    synchronizeEditorTimelineSubtitles(engine, {
      cues: [
        {
          id: "14",
          startTime: 2.5,
          endTime: 4.75,
          text: "First line\nSecond line",
          lines: ["First line", "Second line"],
        },
        {
          startTime: 19,
          endTime: 22,
          text: "Clamped ending",
          lines: ["Clamped ending"],
        },
        {
          startTime: 21,
          endTime: 22,
          text: "Outside duration",
          lines: ["Outside duration"],
        },
      ],
    });

    const state = engine.getState();
    const subtitleTrack = state.tracks.find(
      (track) => track.id === EDITOR_SUBTITLE_TRACK_ID,
    );
    assert.equal(subtitleTrack?.name, EDITOR_SUBTITLE_TRACK_NAME);
    assert.equal(subtitleTrack?.locked, false);
    assert.equal(subtitleTrack?.clips.length, 2);
    assert.equal(subtitleTrack?.clips[0]?.label, "First line\nSecond line");
    assert.equal(subtitleTrack?.clips[0]?.movable, true);
    assert.equal(subtitleTrack?.clips[0]?.resizable, true);
    assert.deepEqual(subtitleCuesFromTimeline(state.tracks), [
      {
        id: "14",
        startTime: 2.5,
        endTime: 4.75,
        text: "First line\nSecond line",
        lines: ["First line", "Second line"],
      },
      {
        startTime: 19,
        endTime: 20,
        text: "Clamped ending",
        lines: ["Clamped ending"],
      },
    ]);
  });

  void it("rebuilds subtitle clips after media duration is discovered", () => {
    const session = createSession({ duration: 0 });
    const engine = createEditorTimelineEngine(session);
    const cues = [
      {
        startTime: 2,
        endTime: 4,
        text: "Visible after discovery",
        lines: ["Visible after discovery"],
      },
    ];

    synchronizeEditorTimelineSubtitles(engine, {
      cues,
    });
    assert.deepEqual(subtitleCuesFromTimeline(engine.getState().tracks), []);

    synchronizeEditorTimelineMedia(engine, {
      duration: 30,
      sourceStart: 0,
      initialDuration: session.duration,
    });
    synchronizeEditorTimelineSubtitles(engine, {
      cues,
    });

    assert.deepEqual(subtitleCuesFromTimeline(engine.getState().tracks), cues);
  });

  void it("keeps customized subtitle text and overlapping cues in engine state", () => {
    const engine = createEditorTimelineEngine(createSession());
    synchronizeEditorTimelineSubtitles(engine, {
      cues: [
        {
          startTime: 2,
          endTime: 5,
          text: "Original",
          lines: ["Original"],
        },
        {
          startTime: 4,
          endTime: 7,
          text: "Overlapping",
          lines: ["Overlapping"],
        },
      ],
    });

    assert.equal(
      engine.updateClipProperties("editor-subtitle-cue-0", {
        label: "Customized\ntext",
      }),
      true,
    );
    const move = engine.commitEdit({
      type: "move",
      clipId: "editor-subtitle-cue-0",
      startTime: fromSeconds(3),
      targetTrackId: EDITOR_SUBTITLE_TRACK_ID,
      snap: false,
    });

    assert.equal(move.committed, true);
    assert.deepEqual(subtitleCuesFromTimeline(engine.getState().tracks), [
      {
        startTime: 3,
        endTime: 6,
        text: "Customized\ntext",
        lines: ["Customized", "text"],
      },
      {
        startTime: 4,
        endTime: 7,
        text: "Overlapping",
        lines: ["Overlapping"],
      },
    ]);
  });
});
