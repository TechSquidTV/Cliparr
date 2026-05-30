/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  createProviderUrlSource,
  type EditorMediaSource,
} from "../../lib/editorMedia";
import {
  buildExportSourceLabel,
  buildExportSourceMessage,
  buildExportSourceSummaryMessage,
  getEditorExportReadiness,
  getOutputDimensions,
  resolveExportSource,
} from "./useEditorExport";

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

  assert.deepEqual(
    resolveExportSource({
      preference: "auto",
      hlsSource,
      directSource,
    }),
    {
      source: hlsSource,
      kind: "hls",
    },
  );

  assert.deepEqual(
    resolveExportSource({
      preference: "direct",
      hlsSource,
      directSource,
    }),
    {
      source: directSource,
      kind: "direct",
    },
  );
});

void test("resolves local file export sources", () => {
  assert.deepEqual(
    resolveExportSource({
      preference: "auto",
      directSource: localFileSource,
    }),
    {
      source: localFileSource,
      kind: "direct",
    },
  );

  assert.deepEqual(
    resolveExportSource({
      preference: "hls",
      directSource: localFileSource,
    }),
    {
      source: null,
      kind: "none",
    },
  );
});

void test("uses export fallback source when auto-selected", () => {
  const hlsSource = createProviderUrlSource("/playback/master.m3u8", "hls");

  assert.deepEqual(
    resolveExportSource({
      preference: "auto",
      hlsSource,
      directSource: localFileSource,
      exportFallbackSource: localFileSource,
    }),
    {
      source: localFileSource,
      kind: "direct",
    },
  );
});

void test("reports editor export readiness and subtitle blockers", () => {
  const hlsSource = createProviderUrlSource("/playback/master.m3u8", "hls");
  const readySource = { source: hlsSource, kind: "hls" as const };
  const textSubtitleTrack = {
    streamId: "subtitle-1",
    isText: true,
    contentUrl: "/subtitles/1.srt",
    contentFormat: "srt",
  };
  const imageSubtitleTrack = {
    streamId: "subtitle-2",
    isText: false,
    codec: "pgs",
  };
  const subtitleCues = [
    {
      startTime: 1,
      endTime: 2,
      text: "Hello",
      lines: ["Hello"],
    },
  ];

  assert.deepEqual(
    getEditorExportReadiness({
      exportSource: { source: null, kind: "none" },
      exporting: false,
      startTime: 0,
      endTime: 10,
      subtitleEnabled: false,
      selectedSubtitleTrack: null,
      clippedSubtitleCues: [],
      subtitleLoading: false,
    }),
    {
      state: "idle",
      shouldBurnSubtitles: false,
    },
  );

  assert.deepEqual(
    getEditorExportReadiness({
      exportSource: readySource,
      exporting: false,
      startTime: 10,
      endTime: 10,
      subtitleEnabled: false,
      selectedSubtitleTrack: null,
      clippedSubtitleCues: [],
      subtitleLoading: false,
    }),
    {
      state: "blocked",
      message: "Waiting for media duration.",
      shouldBurnSubtitles: false,
    },
  );

  assert.deepEqual(
    getEditorExportReadiness({
      exportSource: readySource,
      exporting: false,
      startTime: 0,
      endTime: 10,
      subtitleEnabled: true,
      selectedSubtitleTrack: textSubtitleTrack,
      clippedSubtitleCues: subtitleCues,
      subtitleLoading: true,
    }),
    {
      state: "blocked",
      message: "Subtitles are still loading.",
      shouldBurnSubtitles: true,
    },
  );

  assert.deepEqual(
    getEditorExportReadiness({
      exportSource: readySource,
      exporting: false,
      startTime: 0,
      endTime: 10,
      subtitleEnabled: true,
      selectedSubtitleTrack: imageSubtitleTrack,
      clippedSubtitleCues: subtitleCues,
      subtitleLoading: false,
    }),
    {
      state: "blocked",
      message: "This subtitle track is not supported.",
      shouldBurnSubtitles: true,
    },
  );

  assert.deepEqual(
    getEditorExportReadiness({
      exportSource: readySource,
      exporting: false,
      startTime: 0,
      endTime: 10,
      subtitleEnabled: true,
      selectedSubtitleTrack: textSubtitleTrack,
      clippedSubtitleCues: subtitleCues,
      subtitleLoading: false,
    }),
    {
      state: "ready",
      source: hlsSource,
      sourceKind: "hls",
      shouldBurnSubtitles: true,
    },
  );
});

void test("builds export dimensions and source messaging", () => {
  const hlsSource = createProviderUrlSource("/playback/master.m3u8", "hls");
  const directSource = createProviderUrlSource("/media/movie.mp4", "direct");
  const directUrlSource = {
    kind: "url",
    role: "direct-url",
    label: "URL",
    url: "/api/media/local-url/handle",
  } satisfies EditorMediaSource;

  assert.deepEqual(getOutputDimensions({ width: 1920, height: 1080 }, "720"), {
    width: 1280,
    height: 720,
  });
  assert.deepEqual(
    getOutputDimensions({ width: 1920, height: 1080 }, "original"),
    {
      width: 1920,
      height: 1080,
    },
  );
  assert.equal(getOutputDimensions({ width: 0, height: 1080 }, "720"), null);

  assert.equal(
    buildExportSourceLabel({
      preference: "auto",
      resolvedSourceKind: "direct",
      resolvedSource: directSource,
      exportFallbackSource: directSource,
    }),
    "Auto: Direct/original fallback",
  );

  assert.equal(
    buildExportSourceLabel({
      preference: "hls",
      resolvedSourceKind: "none",
      resolvedSource: null,
    }),
    "Unavailable",
  );

  assert.equal(
    buildExportSourceMessage({
      preference: "auto",
      resolvedSourceKind: "direct",
      resolvedSource: directSource,
      hlsSource,
      directSource,
      hlsFallbackInfo: {
        category: "shared-export-blocking",
        message: "browser cannot read the stream",
      },
    }),
    "Export switched to direct media: browser cannot read the stream",
  );

  assert.equal(
    buildExportSourceMessage({
      preference: "auto",
      resolvedSourceKind: "hls",
      resolvedSource: hlsSource,
      hlsSource,
      directSource,
      hlsFallbackInfo: {
        category: "shared-export-blocking",
        message: "browser cannot read the stream",
      },
    }),
    "Export cannot use this HLS stream: browser cannot read the stream",
  );

  assert.equal(
    buildExportSourceMessage({
      preference: "auto",
      resolvedSourceKind: "direct",
      resolvedSource: directUrlSource,
      hlsFallbackInfo: null,
    }),
    "Export reads this media URL through Cliparr.",
  );

  assert.equal(
    buildExportSourceSummaryMessage({
      preference: "direct",
      resolvedSourceKind: "direct",
      resolvedSource: directSource,
      hlsSource,
    }),
    "Using direct media.",
  );
});
