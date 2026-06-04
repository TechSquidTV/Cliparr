/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  editorSessionFromCurrentlyPlaying,
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
