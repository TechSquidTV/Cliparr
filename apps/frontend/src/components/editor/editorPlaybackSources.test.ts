/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlaybackFailure,
  buildPlaybackLoadError,
  buildPlaybackSourceCandidates,
  PlaybackSourceError,
  resolvePlaybackDuration,
  shouldUseExportFallback,
  type PlaybackLoadFailure,
} from "./editorPlaybackSources";

void test("builds playback source candidates in fallback order without duplicates", () => {
  assert.deepEqual(buildPlaybackSourceCandidates("/playback/master.m3u8", "/media/movie.mp4"), [
    { label: "hls stream", url: "/playback/master.m3u8" },
    { label: "direct source", url: "/media/movie.mp4" },
  ]);

  assert.deepEqual(buildPlaybackSourceCandidates("/media/movie.mp4", "/media/movie.mp4"), [
    { label: "hls stream", url: "/media/movie.mp4" },
  ]);
});

void test("preserves server duration for HLS and uses computed direct duration when available", () => {
  assert.equal(resolvePlaybackDuration(
    { label: "hls stream", url: "/playback/master.m3u8" },
    95,
    100,
  ), 100);

  assert.equal(resolvePlaybackDuration(
    { label: "direct source", url: "/media/movie.mp4" },
    95,
    100,
  ), 95);

  assert.equal(resolvePlaybackDuration(
    { label: "direct source", url: "/media/movie.mp4" },
    Number.NaN,
    100,
  ), 100);
});

void test("classifies source failures and export fallback eligibility", () => {
  const failure = buildPlaybackFailure(
    { label: "hls stream", url: "/playback/master.m3u8" },
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
