/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import type { InputVideoTrack } from "mediabunny";
import {
  createProviderUrlSource,
  type EditorMediaSource,
} from "@/lib/editorMedia";
import {
  buildPlaybackSourceCandidates,
  playbackAudioSelectionsEqual,
  playbackSourceCandidatesEqual,
  resolvePlaybackDuration,
  selectPreviewVideoTrack,
} from "@/components/editor/editorPlaybackSources";

void test("uses the export primary video track even when it is not first in the file", async () => {
  const first = {
    id: 1,
    getCodec: async () => "avc",
    canDecode: async () => true,
  } as InputVideoTrack;
  const primary = {
    id: 2,
    getCodec: async () => "avc",
    canDecode: async () => true,
  } as InputVideoTrack;
  const input = {
    getPrimaryVideoTrack: async () => primary,
    getVideoTracks: async () => [first, primary],
  };
  const selected = await selectPreviewVideoTrack(input);
  assert.equal(selected.sourceVideoTrack, primary);
  assert.equal(selected.previewVideoTrack, primary);

  primary.canDecode = async () => false;
  const recovered = await selectPreviewVideoTrack(input);
  assert.equal(recovered.sourceVideoTrack, primary);
  assert.equal(recovered.previewVideoTrack, first);
});

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
  assert.deepEqual(
    buildPlaybackSourceCandidates(duplicateHlsSource, directSource),
    [{ label: "hls stream", source: duplicateHlsSource }],
  );
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

void test("treats refreshed URL source descriptors as the same playback configuration", () => {
  const first = buildPlaybackSourceCandidates(
    createProviderUrlSource("/playback/master.m3u8", "hls"),
    createProviderUrlSource("/media/movie.mp4", "direct"),
  );
  const refreshed = buildPlaybackSourceCandidates(
    createProviderUrlSource("/playback/master.m3u8", "hls"),
    createProviderUrlSource("/media/movie.mp4", "direct"),
  );
  const changed = buildPlaybackSourceCandidates(
    createProviderUrlSource("/playback/replacement.m3u8", "hls"),
    createProviderUrlSource("/media/movie.mp4", "direct"),
  );

  assert.equal(playbackSourceCandidatesEqual(first, refreshed), true);
  assert.equal(playbackSourceCandidatesEqual(first, changed), false);
});

void test("compares selected audio tracks by playback identity", () => {
  assert.equal(
    playbackAudioSelectionsEqual(
      { trackNumber: 2, languageCode: "eng", title: "English" },
      { trackNumber: 2, languageCode: "eng", title: "English" },
    ),
    true,
  );
  assert.equal(
    playbackAudioSelectionsEqual(
      { trackNumber: 2, languageCode: "eng", title: "English" },
      { trackNumber: 3, languageCode: "spa", title: "Spanish" },
    ),
    false,
  );
});

void test("preserves server duration for HLS and uses computed direct duration when available", () => {
  const hlsSource = createProviderUrlSource("/playback/master.m3u8", "hls");
  const directSource = createProviderUrlSource("/media/movie.mp4", "direct");

  assert.equal(
    resolvePlaybackDuration(
      { label: "hls stream", source: hlsSource },
      95,
      100,
    ),
    100,
  );

  assert.equal(
    resolvePlaybackDuration(
      { label: "direct source", source: directSource },
      95,
      100,
    ),
    95,
  );

  assert.equal(
    resolvePlaybackDuration(
      { label: "direct source", source: directSource },
      Number.NaN,
      100,
    ),
    100,
  );
});
