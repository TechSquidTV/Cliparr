/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { createProviderUrlSource, type EditorMediaSource } from "../../lib/editorMedia";
import {
  buildPlaybackFailure,
  buildPlaybackLoadError,
  buildPlaybackSourceCandidates,
  PlaybackSourceError,
  resolvePlaybackDuration,
  shouldUseExportFallback,
  type PlaybackLoadFailure,
} from "./editorPlaybackSources";

function localFileSource(label = "movie.mp4") {
  return {
    kind: "file",
    role: "local-file",
    label: "Local file",
    file: new File(["video"], label, { type: "video/mp4" }),
    fileName: label,
    mimeType: "video/mp4",
    size: 5,
  } satisfies EditorMediaSource;
}

void test("builds playback source candidates in fallback order without duplicates", () => {
  const hlsSource = createProviderUrlSource("/playback/master.m3u8", "hls");
  const directSource = createProviderUrlSource("/media/movie.mp4", "direct");

  assert.deepEqual(buildPlaybackSourceCandidates(hlsSource, directSource), [
    { label: "hls stream", source: hlsSource },
    { label: "direct source", source: directSource },
  ]);

  const duplicateHlsSource = createProviderUrlSource("/media/movie.mp4", "hls");
  assert.deepEqual(buildPlaybackSourceCandidates(duplicateHlsSource, directSource), [
    { label: "hls stream", source: duplicateHlsSource },
  ]);
});

void test("builds local file and URL playback candidates", () => {
  const fileSource = localFileSource();
  const urlSource = {
    kind: "url",
    role: "direct-url",
    label: "URL",
    url: "https://example.com/movie.mp4",
    hls: false,
  } satisfies EditorMediaSource;
  const hlsUrlSource = {
    ...urlSource,
    label: "HLS URL",
    url: "https://example.com/master.m3u8",
    hls: true,
  } satisfies EditorMediaSource;

  assert.deepEqual(buildPlaybackSourceCandidates(undefined, fileSource), [
    { label: "local file", source: fileSource },
  ]);
  assert.deepEqual(buildPlaybackSourceCandidates(hlsUrlSource, urlSource), [
    { label: "hls url", source: hlsUrlSource },
    { label: "url", source: urlSource },
  ]);
});

void test("preserves server duration for HLS and uses computed direct duration when available", () => {
  const hlsSource = createProviderUrlSource("/playback/master.m3u8", "hls");
  const directSource = createProviderUrlSource("/media/movie.mp4", "direct");

  assert.equal(resolvePlaybackDuration(
    { label: "hls stream", source: hlsSource },
    95,
    100,
  ), 100);

  assert.equal(resolvePlaybackDuration(
    { label: "direct source", source: directSource },
    95,
    100,
  ), 95);

  assert.equal(resolvePlaybackDuration(
    { label: "direct source", source: directSource },
    Number.NaN,
    100,
  ), 100);
});

void test("classifies source failures and export fallback eligibility", () => {
  const failure = buildPlaybackFailure(
    { label: "hls stream", source: createProviderUrlSource("/playback/master.m3u8", "hls") },
    new PlaybackSourceError("shared-export-blocking", "Decoder unavailable"),
  );

  assert.deepEqual(failure, {
    label: "hls stream",
    message: "Decoder unavailable",
    classification: "hls-playlist",
    category: "shared-export-blocking",
  });
  assert.equal(shouldUseExportFallback(failure), true);
});

void test("deduplicates playback load errors that share the same underlying message", () => {
  const failures: PlaybackLoadFailure[] = [
    {
      label: "hls stream",
      message: "Network denied",
      classification: "hls-playlist",
      category: "open-or-read",
    },
    {
      label: "direct source",
      message: "Network denied",
      classification: "unknown",
      category: "open-or-read",
    },
  ];

  assert.equal(
    buildPlaybackLoadError(failures),
    "Cliparr could not open any playback stream. Network denied",
  );
});
