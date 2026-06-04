/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  editorSessionFromCurrentlyPlaying,
  mergeEditorSessionRefresh,
  titleFromUrl,
} from "@/lib/editorMedia";
import type { CurrentlyPlayingItem } from "@/providers/types";

void test("uses the URL host as the title when no path segment is present", () => {
  assert.equal(titleFromUrl("https://example.com/"), "example.com");
  assert.equal(titleFromUrl("https://example.com"), "example.com");
});

void test("uses the final URL path segment as the title when present", () => {
  assert.equal(
    titleFromUrl("https://example.com/media/example%20clip.mp4"),
    "example clip",
  );
});

void test("passes provider playhead seconds into editor sessions", () => {
  const item: CurrentlyPlayingItem = {
    id: "source-1:session-1",
    source: {
      id: "source-1",
      name: "Plex",
      providerId: "plex",
    },
    title: "Example",
    type: "movie",
    duration: 600,
    playheadSeconds: 123.456,
    playerTitle: "Living Room",
    playerState: "playing",
    mediaUrl: "/api/media/direct",
    exportEstimateMetadata: {
      sourceSizeBytes: 120_000_000,
      sourceDurationSeconds: 600,
      sourceBitrateKbps: 1_600,
    },
  };

  const session = editorSessionFromCurrentlyPlaying(item);

  assert.equal(session.initialPlayheadSeconds, 123.456);
  assert.deepEqual(session.exportEstimateMetadata, {
    sourceSizeBytes: 120_000_000,
    sourceDurationSeconds: 600,
    sourceBitrateKbps: 1_600,
  });
});

void test("preserves generated media handles when refreshing the same editor session", () => {
  const baseItem: CurrentlyPlayingItem = {
    id: "source-1:session-1",
    source: {
      id: "source-1",
      name: "Plex",
      providerId: "plex",
    },
    title: "Example",
    type: "movie",
    duration: 600,
    playheadSeconds: 120,
    playerTitle: "Living Room",
    playerState: "playing",
    thumbUrl: "/api/media/thumb-old",
    mediaUrl: "/api/media/direct-old",
    hlsUrl: "/api/media/hls-old",
    selectedAudioTrack: {
      trackNumber: 1,
      languageCode: "eng",
      title: "English",
    },
    selectedSubtitleTrack: {
      streamId: "10",
      languageCode: "eng",
      title: "English",
      codec: "srt",
      contentFormat: "srt",
      isText: true,
    },
    subtitleTracks: [
      {
        streamId: "10",
        languageCode: "eng",
        title: "English",
        codec: "srt",
        contentFormat: "srt",
        isText: true,
        contentUrl: "/api/media/subtitle-old",
      },
    ],
  };
  const current = editorSessionFromCurrentlyPlaying(baseItem);
  const next = editorSessionFromCurrentlyPlaying({
    ...baseItem,
    title: "Example Updated",
    playheadSeconds: 180,
    playerState: "paused",
    thumbUrl: "/api/media/thumb-new",
    mediaUrl: "/api/media/direct-new",
    hlsUrl: "/api/media/hls-new",
    subtitleTracks: [
      {
        streamId: "10",
        languageCode: "eng",
        title: "English",
        codec: "srt",
        contentFormat: "srt",
        isText: true,
        contentUrl: "/api/media/subtitle-new",
      },
    ],
  });

  const merged = mergeEditorSessionRefresh(current, next);

  assert.equal(merged.title, "Example Updated");
  assert.equal(merged.playerState, "paused");
  assert.equal(merged.initialPlayheadSeconds, 120);
  assert.equal(merged.thumbUrl, "/api/media/thumb-old");
  assert.equal(merged.directSource?.kind, "url");
  assert.equal(
    merged.directSource?.kind === "url" && merged.directSource.url,
    "/api/media/direct-old",
  );
  assert.equal(merged.hlsSource?.kind, "url");
  assert.equal(
    merged.hlsSource?.kind === "url" && merged.hlsSource.url,
    "/api/media/hls-old",
  );
  assert.equal(merged.selectedAudioTrack, current.selectedAudioTrack);
  assert.equal(merged.selectedSubtitleTrack, current.selectedSubtitleTrack);
  assert.equal(
    merged.subtitleTracks?.[0]?.contentUrl,
    "/api/media/subtitle-old",
  );
});

void test("does not preserve generated media handles for a different editor session", () => {
  const current = editorSessionFromCurrentlyPlaying({
    id: "source-1:session-1",
    source: {
      id: "source-1",
      name: "Plex",
      providerId: "plex",
    },
    title: "Old",
    type: "movie",
    duration: 600,
    playerTitle: "Living Room",
    playerState: "playing",
    hlsUrl: "/api/media/hls-old",
  });
  const next = editorSessionFromCurrentlyPlaying({
    id: "source-1:session-2",
    source: {
      id: "source-1",
      name: "Plex",
      providerId: "plex",
    },
    title: "New",
    type: "movie",
    duration: 600,
    playerTitle: "Living Room",
    playerState: "playing",
    hlsUrl: "/api/media/hls-new",
  });

  const merged = mergeEditorSessionRefresh(current, next);

  assert.equal(merged.id, "source-1:session-2");
  assert.equal(merged.hlsSource?.kind, "url");
  assert.equal(
    merged.hlsSource?.kind === "url" && merged.hlsSource.url,
    "/api/media/hls-new",
  );
});
