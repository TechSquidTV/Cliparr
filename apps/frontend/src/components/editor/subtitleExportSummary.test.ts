/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import type { PlaybackSubtitleTrack } from "@/providers/types";
import { buildSubtitleExportSummary } from "@/components/editor/subtitleExportSummary";

const supportedTrack = {
  title: "English SDH",
  languageCode: "en",
  isText: true,
  contentUrl: "/api/media/subtitles/en.srt",
} satisfies PlaybackSubtitleTrack;

void test("summarizes disabled subtitle burn-in with and without available tracks", () => {
  assert.deepEqual(
    buildSubtitleExportSummary({
      selectedSubtitleTrack: supportedTrack,
      subtitleEnabled: false,
      subtitleTrackCount: 1,
      clippedSubtitleCueCount: 3,
      subtitleLoading: false,
      subtitleError: null,
      providerId: "plex",
    }),
    {
      label: "Not included",
      detail: "Subtitles are off.",
      tone: "muted",
      disabledReason: null,
    },
  );

  assert.deepEqual(
    buildSubtitleExportSummary({
      selectedSubtitleTrack: null,
      subtitleEnabled: false,
      subtitleTrackCount: 0,
      clippedSubtitleCueCount: 0,
      subtitleLoading: false,
      subtitleError: null,
      providerId: "plex",
    }),
    {
      label: "Not included",
      detail: "No supported subtitles found.",
      tone: "muted",
      disabledReason: null,
    },
  );
});

void test("blocks export when the selected subtitle track is unsupported", () => {
  assert.deepEqual(
    buildSubtitleExportSummary({
      selectedSubtitleTrack: {
        title: "Embedded English",
        languageCode: "en",
        isText: true,
      },
      subtitleEnabled: true,
      subtitleTrackCount: 1,
      clippedSubtitleCueCount: 0,
      subtitleLoading: false,
      subtitleError: null,
      providerId: "plex",
    }),
    {
      label: "Not supported",
      detail: "Select this embedded subtitle in Plex first.",
      tone: "warning",
      disabledReason: "Choose another subtitle track or turn subtitles off.",
    },
  );
});

void test("blocks export while subtitle cues are loading or errored", () => {
  assert.deepEqual(
    buildSubtitleExportSummary({
      selectedSubtitleTrack: supportedTrack,
      subtitleEnabled: true,
      subtitleTrackCount: 1,
      clippedSubtitleCueCount: 0,
      subtitleLoading: true,
      subtitleError: null,
      providerId: "jellyfin",
    }),
    {
      label: "Loading",
      detail: "Preparing subtitles.",
      tone: "warning",
      disabledReason: "Subtitles are still loading.",
    },
  );

  assert.deepEqual(
    buildSubtitleExportSummary({
      selectedSubtitleTrack: supportedTrack,
      subtitleEnabled: true,
      subtitleTrackCount: 1,
      clippedSubtitleCueCount: 0,
      subtitleLoading: false,
      subtitleError: "Subtitles timed out. Try again.",
      providerId: "jellyfin",
    }),
    {
      label: "Issue",
      detail: "Subtitles timed out. Try again.",
      tone: "warning",
      disabledReason: "Subtitles timed out. Try again.",
    },
  );
});

void test("summarizes empty and ready cue states", () => {
  assert.deepEqual(
    buildSubtitleExportSummary({
      selectedSubtitleTrack: supportedTrack,
      subtitleEnabled: true,
      subtitleTrackCount: 1,
      clippedSubtitleCueCount: 0,
      subtitleLoading: false,
      subtitleError: null,
      providerId: "jellyfin",
    }),
    {
      label: "None in range",
      detail: "No subtitles in the selected range.",
      tone: "muted",
      disabledReason: null,
    },
  );

  assert.deepEqual(
    buildSubtitleExportSummary({
      selectedSubtitleTrack: supportedTrack,
      subtitleEnabled: true,
      subtitleTrackCount: 1,
      clippedSubtitleCueCount: 2,
      subtitleLoading: false,
      subtitleError: null,
      providerId: "jellyfin",
    }),
    {
      label: "Included",
      detail: "English SDH will be burned in.",
      tone: "ready",
      disabledReason: null,
    },
  );
});
