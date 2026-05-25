/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import type { PlaybackSubtitleTrack } from "../../providers/types";
import { buildSubtitleExportSummary } from "./subtitleExportSummary";

const supportedTrack = {
  title: "English SDH",
  languageCode: "en",
  isText: true,
  contentUrl: "/api/media/subtitles/en.srt",
} satisfies PlaybackSubtitleTrack;

void test("summarizes disabled subtitle burn-in with and without available tracks", () => {
  assert.deepEqual(buildSubtitleExportSummary({
    selectedSubtitleTrack: supportedTrack,
    subtitleEnabled: false,
    subtitleTrackCount: 1,
    clippedSubtitleCueCount: 3,
    subtitleLoading: false,
    subtitleError: null,
    providerId: "plex",
  }), {
    label: "Not included",
    detail: "Subtitle burn-in is currently turned off for this export.",
    tone: "muted",
    disabledReason: null,
  });

  assert.deepEqual(buildSubtitleExportSummary({
    selectedSubtitleTrack: null,
    subtitleEnabled: false,
    subtitleTrackCount: 0,
    clippedSubtitleCueCount: 0,
    subtitleLoading: false,
    subtitleError: null,
    providerId: "plex",
  }), {
    label: "Not included",
    detail: "No supported text subtitle tracks are available for this session.",
    tone: "muted",
    disabledReason: null,
  });
});

void test("blocks export when the selected subtitle track is unsupported", () => {
  assert.deepEqual(buildSubtitleExportSummary({
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
  }), {
    label: "Unsupported track",
    detail: "Plex detected this embedded text subtitle track, but only the currently selected embedded subtitle can be fetched for styled burn-in.",
    tone: "warning",
    disabledReason: "Choose a supported text subtitle track or turn subtitle burn-in off.",
  });
});

void test("blocks export while subtitle cues are loading or errored", () => {
  assert.deepEqual(buildSubtitleExportSummary({
    selectedSubtitleTrack: supportedTrack,
    subtitleEnabled: true,
    subtitleTrackCount: 1,
    clippedSubtitleCueCount: 0,
    subtitleLoading: true,
    subtitleError: null,
    providerId: "jellyfin",
  }), {
    label: "Loading cues",
    detail: "English SDH is still being prepared for burn-in.",
    tone: "warning",
    disabledReason: "Subtitles are still loading. Please wait for the cue list to finish loading.",
  });

  assert.deepEqual(buildSubtitleExportSummary({
    selectedSubtitleTrack: supportedTrack,
    subtitleEnabled: true,
    subtitleTrackCount: 1,
    clippedSubtitleCueCount: 0,
    subtitleLoading: false,
    subtitleError: "Subtitle request timed out. Please try again.",
    providerId: "jellyfin",
  }), {
    label: "Subtitle issue",
    detail: "Subtitle request timed out. Please try again.",
    tone: "warning",
    disabledReason: "Subtitle request timed out. Please try again.",
  });
});

void test("summarizes empty and ready cue states", () => {
  assert.deepEqual(buildSubtitleExportSummary({
    selectedSubtitleTrack: supportedTrack,
    subtitleEnabled: true,
    subtitleTrackCount: 1,
    clippedSubtitleCueCount: 0,
    subtitleLoading: false,
    subtitleError: null,
    providerId: "jellyfin",
  }), {
    label: "No cues found",
    detail: "English SDH has no subtitle cues inside the selected clip range.",
    tone: "muted",
    disabledReason: null,
  });

  assert.deepEqual(buildSubtitleExportSummary({
    selectedSubtitleTrack: supportedTrack,
    subtitleEnabled: true,
    subtitleTrackCount: 1,
    clippedSubtitleCueCount: 2,
    subtitleLoading: false,
    subtitleError: null,
    providerId: "jellyfin",
  }), {
    label: "Burned in",
    detail: "English SDH will be rendered into the exported video frames.",
    tone: "ready",
    disabledReason: null,
  });
});
