import assert from "node:assert/strict";
import test from "node:test";
import { reduceExportSelection } from "#/components/editor/useExportSettings";

for (const videoMuted of [false, true]) {
  void test(`remembers formats and ${videoMuted ? "muted" : "audible"} video through audio and GIF`, () => {
    let state: Parameters<typeof reduceExportSelection>[0] = {
      outputType: "video",
      videoMuted: false,
      video: "mp4",
      audio: "mp3",
      videoResolution: "original",
      gifPreset: "balanced",
      videoQuality: "sharp",
      mixDownToStereo: true,
    };
    state = reduceExportSelection(state, { videoMuted });
    state = reduceExportSelection(state, { format: "mov" });
    state = reduceExportSelection(state, { resolution: "1080" });
    state = reduceExportSelection(state, { quality: "compact" });
    state = reduceExportSelection(state, { outputType: "audio" });
    state = reduceExportSelection(state, { format: "flac" });
    state = reduceExportSelection(state, { outputType: "video" });
    assert.equal(state.video, "mov");
    assert.equal(state.audio, "flac");
    assert.equal(state.videoMuted, videoMuted);
    state = reduceExportSelection(state, { outputType: "gif" });
    state = reduceExportSelection(state, { quality: "efficient" });
    assert.equal(state.videoMuted, videoMuted);
    state = reduceExportSelection(state, { outputType: "audio" });
    state = reduceExportSelection(state, { outputType: "video" });
    assert.equal(state.video, "mov");
    assert.equal(state.videoResolution, "1080");
    assert.equal(state.gifPreset, "efficient");
    assert.equal(state.videoQuality, "compact");
    assert.equal(state.audio, "flac");
    state = reduceExportSelection(state, { format: "mp4" });
    assert.equal(state.videoMuted, videoMuted);
    // Quick templates target the quality of the new output type in one batch.
    state = reduceExportSelection(state, { format: "gif" });
    state = reduceExportSelection(state, { quality: "balanced" });
    assert.equal(state.outputType, "gif");
    assert.equal(state.gifPreset, "balanced");
    assert.equal(state.videoQuality, "compact");
    assert.equal(state.videoResolution, "1080");
    state = reduceExportSelection(state, { format: "mp4" });
    assert.equal(state.outputType, "video");
    assert.equal(state.videoResolution, "1080");
    assert.equal(reduceExportSelection(state, { quality: "efficient" }), state);
    state = reduceExportSelection(state, { outputType: "audio" });
    assert.equal(reduceExportSelection(state, { quality: "sharp" }), state);
    assert.equal(reduceExportSelection(state, { resolution: "720" }), state);
    state = reduceExportSelection(state, { outputType: "gif" });
    assert.equal(reduceExportSelection(state, { resolution: "720" }), state);
  });
}
