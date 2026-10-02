import assert from "node:assert/strict";
import test from "node:test";
import {
  exportFormats,
  exportClip,
  exportFormatFor,
  exportIncludesAudio,
  gifExportSettingsForPreset,
  titleFromFileName,
} from "@cliparr/frontend/convert";

void test("convert facade exposes supported output formats", () => {
  assert.deepEqual(
    exportFormats.map((option) => option.value),
    ["mp4", "webm", "gif", "mov", "mkv", "mp3", "m4a", "ogg", "flac", "wav"],
  );
  assert.equal(exportFormatFor("webm").extension, ".webm");
  assert.equal(exportFormatFor("gif").extension, ".gif");
});

void test("convert facade exposes export helpers", () => {
  assert.equal(typeof exportClip, "function");
  assert.equal(exportIncludesAudio("video-audio", "mp4"), true);
  assert.equal(exportIncludesAudio("video-only", "gif"), false);
  assert.equal(gifExportSettingsForPreset("balanced").preset, "balanced");
  assert.equal(titleFromFileName("source-video.mp4"), "source-video");
});
