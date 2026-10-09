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
  createSubtitleClip,
  getSubtitleCreationRange,
  subtitleCuesFromTimeline,
  synchronizeEditorTimelineMedia,
  synchronizeEditorTimelineSession,
  synchronizeEditorTimelineSubtitles,
  timelineScrollLeftForCenteredTime,
} from "@/components/editor/editorTimelineEngine";
import type { EditorSession } from "@/components/editor/editorMedia";
import { createEditorHistory } from "@/components/editor/editorHistory";

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
  void it("shares zoom bounds across controls, from the full movie to subtitle detail", () => {
    const engine = createEditorTimelineEngine(
      createSession({ duration: 3600 }),
    );
    engine.setViewportWidth(1000);
    engine.setZoomScale(0.01);
    assert.equal(engine.zoomScale, 1000 / 3600);
    engine.setZoomScale(10_000);
    assert.equal(engine.zoomScale, 1000);
    assert.equal(toSeconds(engine.getState().duration!), 3600);
  });

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
    assert.equal(state.tracks[0]?.locked, true);
    assert.equal(toSeconds(state.playheadTime), 12);
    assert.equal(toSeconds(state.inPoint!), 12);
    assert.equal(toSeconds(state.outPoint!), 22);
    assert.equal(state.zoomScale, 74);
  });

  void it("restores the source lock and rejects the whole metadata edit when validation fails", () => {
    const engine = createEditorTimelineEngine(createSession());
    const initialClip = engine.getState().tracks[0]?.clips[0];
    engine.setEditPolicy({
      canTrimClip: () => ({ valid: false, reason: "policy-rejected" }),
    });

    assert.throws(
      () =>
        synchronizeEditorTimelineMedia(engine, {
          duration: 30,
          sourceStart: 100,
          initialDuration: 20,
        }),
      /Could not synchronize media timeline: policy-rejected/,
    );

    const state = engine.getState();
    assert.equal(state.tracks[0]?.locked, true);
    assert.deepEqual(state.tracks[0]?.clips[0], initialClip);
    assert.equal(toSeconds(state.duration!), 20);
  });

  void it("uses the shared range policy for external media playback", () => {
    const engine = createEditorTimelineEngine(createSession());
    assert.equal(
      engine.play({ clock: "external", respectInOut: true, loop: false }),
      true,
    );
    const update = engine.updateExternalPlaybackTime(fromSeconds(16));

    assert.equal(update.action, "pause");
    assert.equal(update.reason, "in-out");
    assert.equal(toSeconds(engine.getTime()), 15);
    assert.equal(engine.getState().playing, false);
    assert.equal(
      toSeconds(engine.getPlaybackStartTime({ respectInOut: true })),
      5,
    );
  });

  void it("moves the selection as one undoable range without moving source media or subtitles", () => {
    const engine = createEditorTimelineEngine(createSession());
    synchronizeEditorTimelineMedia(engine, {
      duration: 20,
      sourceStart: 1_700_000_000,
      initialDuration: 20,
    });
    synchronizeEditorTimelineSubtitles(engine, {
      cues: [
        { startTime: 2, endTime: 4, text: "Fixed cue", lines: ["Fixed cue"] },
      ],
    });
    const initialTracks = engine.getState().tracks;
    const history = createEditorHistory(engine);

    history.beginRangeGesture();
    for (const start of [6, 7, 8, 10]) {
      engine.setInOutRange(fromSeconds(start), fromSeconds(start + 10));
    }
    history.endRangeGesture();

    assert.equal(toSeconds(engine.getState().duration!), 20);
    assert.equal(toSeconds(engine.maxContentTime), 20);
    assert.deepEqual(engine.getState().tracks, initialTracks);
    assert.equal(toSeconds(engine.getState().inPoint!), 10);
    assert.equal(toSeconds(engine.getState().outPoint!), 20);
    // The playhead can still inspect source media before the selected clip.
    engine.updatePlayhead(fromSeconds(1));
    assert.equal(toSeconds(engine.getTime()), 1);

    history.undo();
    assert.equal(toSeconds(engine.getState().inPoint!), 5);
    assert.equal(toSeconds(engine.getState().outPoint!), 15);
    assert.equal(history.getSnapshot().canUndo, false);
    history.redo();
    assert.equal(toSeconds(engine.getState().inPoint!), 10);
    assert.equal(toSeconds(engine.getState().outPoint!), 20);
    assert.deepEqual(engine.getState().tracks, initialTracks);
    history.dispose();
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

  void it("synchronizes refreshed session metadata without replacing engine-owned edits", () => {
    const warmSession = createSession({ duration: 20, title: "Warm title" });
    const engine = createEditorTimelineEngine(warmSession);
    synchronizeEditorTimelineSubtitles(engine, {
      cues: [
        {
          id: "custom",
          startTime: 2,
          endTime: 4,
          text: "Customized subtitle",
          lines: ["Customized subtitle"],
        },
      ],
    });
    engine.setInPoint(fromSeconds(3));
    engine.setOutPoint(fromSeconds(12));
    engine.setZoomScale(180);

    synchronizeEditorTimelineSession(
      engine,
      warmSession,
      createSession({ duration: 25, title: "Fetched title" }),
    );

    const state = engine.getState();
    assert.equal(toSeconds(state.duration!), 25);
    assert.equal(state.tracks[0]?.clips[0]?.label, "Fetched title");
    assert.equal(toSeconds(state.inPoint!), 3);
    assert.equal(toSeconds(state.outPoint!), 12);
    assert.equal(state.zoomScale, 180);
    assert.deepEqual(subtitleCuesFromTimeline(state.tracks), [
      {
        id: "custom",
        startTime: 2,
        endTime: 4,
        text: "Customized subtitle",
        lines: ["Customized subtitle"],
      },
    ]);
  });

  void it("discovers the export range when refreshed session metadata supplies duration", () => {
    const warmSession = createSession({
      duration: 0,
      initialPlayheadSeconds: 8,
    });
    const engine = createEditorTimelineEngine(warmSession);

    synchronizeEditorTimelineSession(
      engine,
      warmSession,
      createSession({ duration: 30, initialPlayheadSeconds: 8 }),
    );

    const state = engine.getState();
    assert.equal(toSeconds(state.duration!), 30);
    assert.equal(toSeconds(state.inPoint!), 8);
    assert.equal(toSeconds(state.outPoint!), 18);
    assert.equal(toSeconds(state.playheadTime), 8);
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
          id: "clamped",
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
        id: "clamped",
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
        id: "discovered",
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
          id: "editor-subtitle-cue-0",
          startTime: 2,
          endTime: 5,
          text: "Original",
          lines: ["Original"],
        },
        {
          id: "overlapping",
          startTime: 4,
          endTime: 7,
          text: "Overlapping",
          lines: ["Overlapping"],
        },
      ],
    });

    assert.deepEqual(
      engine.updateClipProperties("editor-subtitle-cue-0", {
        label: "Customized\ntext",
      }),
      { ok: true },
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
        id: "editor-subtitle-cue-0",
        startTime: 3,
        endTime: 6,
        text: "Customized\ntext",
        lines: ["Customized", "text"],
      },
      {
        id: "overlapping",
        startTime: 4,
        endTime: 7,
        text: "Overlapping",
        lines: ["Overlapping"],
      },
    ]);
  });

  void it("keeps timeline subtitle text and rendered lines synchronized", () => {
    const engine = createEditorTimelineEngine(createSession());
    synchronizeEditorTimelineSubtitles(engine, {
      cues: [
        {
          id: "editor-subtitle-cue-0",
          startTime: 2,
          endTime: 5,
          text: "Original",
          lines: ["Original"],
        },
      ],
    });

    assert.deepEqual(
      engine.updateClipProperties("editor-subtitle-cue-0", {
        label: "  First line  \r\n\r\n Second line ",
      }),
      { ok: true },
    );
    assert.deepEqual(subtitleCuesFromTimeline(engine.getState().tracks), [
      {
        id: "editor-subtitle-cue-0",
        startTime: 2,
        endTime: 5,
        text: "First line\nSecond line",
        lines: ["First line", "Second line"],
      },
    ]);
  });
});

void describe("subtitle authoring", () => {
  for (const [start, expectedEnd] of [
    [0, 2],
    [1, 2],
    [2, null],
    [5, null],
    [8, null],
    [9, 10],
    [10, null],
    [11, null],
    [12, 14],
    [19, 20],
    [20, null],
    [-1, null],
    [Number.NaN, null],
  ] as const) {
    void it(`creates only in empty time at ${start}, capped at ${expectedEnd}`, () => {
      const engine = createEditorTimelineEngine(createSession());
      synchronizeEditorTimelineSubtitles(engine, {
        cues: [
          {
            id: "later",
            startTime: 10,
            endTime: 12,
            text: "Later",
            lines: ["Later"],
          },
          {
            id: "original",
            startTime: 2,
            endTime: 8,
            text: "Original",
            lines: ["Original"],
          },
          {
            id: "overlapping",
            startTime: 5,
            endTime: 9,
            text: "Overlap",
            lines: ["Overlap"],
          },
        ],
      });
      engine.toggleTrackVisibility(EDITOR_SUBTITLE_TRACK_ID, false);
      const before = subtitleCuesFromTimeline(engine.getState().tracks);
      const range = getSubtitleCreationRange(
        engine.getState().tracks,
        start,
        20,
      );
      if (expectedEnd === null) {
        assert.equal(range, null);
        assert.deepEqual(
          subtitleCuesFromTimeline(engine.getState().tracks),
          before,
        );
        return;
      }
      assert.deepEqual(range, { startTime: start, endTime: expectedEnd });
      assert.ok(range);
      const clip = createSubtitleClip({ ...range, text: "New" }, 20);
      assert.ok(clip);
      const history = createEditorHistory(engine);
      history.runAction(() => {
        assert.equal(
          engine.commitEdit({
            type: "overwrite",
            targetTrackId: EDITOR_SUBTITLE_TRACK_ID,
            startTime: fromSeconds(start),
            clip,
            snap: false,
          }).committed,
          true,
        );
        engine.toggleTrackVisibility(EDITOR_SUBTITLE_TRACK_ID, true);
      });
      const after = subtitleCuesFromTimeline(engine.getState().tracks);
      assert.deepEqual(
        after.filter((cue) => cue.id !== clip.id),
        before,
      );
      assert.equal(after.length, before.length + 1);
      history.undo();
      assert.deepEqual(
        subtitleCuesFromTimeline(engine.getState().tracks),
        before,
      );
      assert.equal(
        engine
          .getState()
          .tracks.find((track) => track.id === EDITOR_SUBTITLE_TRACK_ID)
          ?.visible,
        false,
      );
      assert.equal(history.getSnapshot().canUndo, false);
      history.redo();
      assert.deepEqual(
        subtitleCuesFromTimeline(engine.getState().tracks),
        after,
      );
      assert.equal(
        engine
          .getState()
          .tracks.find((track) => track.id === EDITOR_SUBTITLE_TRACK_ID)
          ?.visible,
        true,
      );
      history.dispose();
    });
  }
  void it("defaults to two seconds on an empty lane and requires a valid media duration", () => {
    const engine = createEditorTimelineEngine(createSession());
    const tracks = engine.getState().tracks;
    assert.deepEqual(getSubtitleCreationRange(tracks, 0, 20), {
      startTime: 0,
      endTime: 2,
    });
    assert.deepEqual(getSubtitleCreationRange(tracks, 0, 1), {
      startTime: 0,
      endTime: 1,
    });
    for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(getSubtitleCreationRange(tracks, 0, duration), null);
    }
    assert.equal(getSubtitleCreationRange([], 0, 20), null);
  });
  void it("creates text without a provider, normalizes it, and clamps to video end", () => {
    const clip = createSubtitleClip(
      { startTime: 19, endTime: 23, text: "  Meme\r\n text  " },
      20,
    );
    assert.ok(clip);
    assert.equal(toSeconds(clip.timelineStart), 19);
    assert.equal(toSeconds(clip.timelineEnd), 20);
    assert.equal(clip.label, "Meme\ntext");
    assert.equal(
      createSubtitleClip({ startTime: 20, endTime: 22, text: "End" }, 20),
      null,
    );
    assert.equal(
      createSubtitleClip({ startTime: 0, endTime: 2, text: "   " }, 20),
      null,
    );
  });
  void it("sorts cues and preserves unique editor identities across draft restoration", () => {
    const engine = createEditorTimelineEngine(createSession());
    synchronizeEditorTimelineSubtitles(engine, {
      cues: [
        {
          id: "same",
          startTime: 8,
          endTime: 10,
          text: "Later",
          lines: ["Later"],
        },
        {
          id: "same",
          startTime: 1,
          endTime: 2,
          text: "Earlier",
          lines: ["Earlier"],
        },
      ],
    });
    const cues = subtitleCuesFromTimeline(engine.getState().tracks);
    assert.deepEqual(
      cues.map((cue) => cue.startTime),
      [1, 8],
    );
    assert.notEqual(cues[0]?.id, cues[1]?.id);
    synchronizeEditorTimelineSubtitles(engine, { cues });
    assert.deepEqual(subtitleCuesFromTimeline(engine.getState().tracks), cues);
  });
});
