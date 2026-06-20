import assert from "node:assert/strict";
import test from "node:test";
import {
  convertFormatOptions,
  exportClip,
  exportFormatExtension,
  exportFormatSupportsAudio,
  gifExportSettingsForPreset,
  titleFromFileName,
} from "@cliparr/frontend/convert";

void test("convert facade exposes supported output formats", () => {
  assert.deepEqual(
    convertFormatOptions.map((option) => option.value),
    ["mp4", "webm", "gif", "mov", "mkv"],
  );
  assert.equal(exportFormatExtension("webm"), ".webm");
  assert.equal(exportFormatExtension("gif"), ".gif");
});

void test("convert facade exposes export helpers", () => {
  assert.equal(typeof exportClip, "function");
  assert.equal(exportFormatSupportsAudio("mp4"), true);
  assert.equal(exportFormatSupportsAudio("gif"), false);
  assert.equal(gifExportSettingsForPreset("balanced").preset, "balanced");
  assert.equal(titleFromFileName("source-video.mp4"), "source-video");
});
