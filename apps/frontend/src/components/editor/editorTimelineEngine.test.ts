import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toSeconds } from "@techsquidtv/canvas-timeline";
import {
  EDITOR_MEDIA_CLIP_ID,
  EDITOR_MEDIA_TRACK_ID,
  EDITOR_SUBTITLE_TRACK_ID,
  createEditorTimelineEngine,
  synchronizeEditorTimelineMedia,
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
});
