/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { createProviderUrlSource, type EditorMediaSource } from "../../lib/editorMedia";
import { resolveExportSource } from "./useEditorExport";

const localFileSource = {
  kind: "file",
  role: "local-file",
  label: "Local file",
  file: new File(["video"], "movie.mp4", { type: "video/mp4" }),
  fileName: "movie.mp4",
} satisfies EditorMediaSource;

void test("resolves provider export sources by preference", () => {
  const hlsSource = createProviderUrlSource("/playback/master.m3u8", "hls");
  const directSource = createProviderUrlSource("/media/movie.mp4", "direct");

  assert.deepEqual(resolveExportSource({
    preference: "auto",
    hlsSource,
    directSource,
  }), {
    source: hlsSource,
    kind: "hls",
  });

  assert.deepEqual(resolveExportSource({
    preference: "direct",
    hlsSource,
    directSource,
  }), {
    source: directSource,
    kind: "direct",
  });
});

void test("resolves local file export sources", () => {
  assert.deepEqual(resolveExportSource({
    preference: "auto",
    directSource: localFileSource,
  }), {
    source: localFileSource,
    kind: "direct",
  });

  assert.deepEqual(resolveExportSource({
    preference: "hls",
    directSource: localFileSource,
  }), {
    source: null,
    kind: "none",
  });
});

void test("uses export fallback source when auto-selected", () => {
  const hlsSource = createProviderUrlSource("/playback/master.m3u8", "hls");

  assert.deepEqual(resolveExportSource({
    preference: "auto",
    hlsSource,
    directSource: localFileSource,
    exportFallbackSource: localFileSource,
  }), {
    source: localFileSource,
    kind: "direct",
  });
});
