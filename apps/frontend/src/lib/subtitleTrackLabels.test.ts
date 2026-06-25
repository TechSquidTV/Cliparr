/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSubtitleTrackLabel,
  formatSubtitleTrackTechnicalSummary,
} from "@/lib/subtitleTrackLabels";
import type { PlaybackSubtitleTrack } from "@/providers/types";

void test("formats subtitle track labels for selector summary and timeline surfaces", () => {
  const track = {
    title: " English SDH ",
    languageCode: " en ",
    codec: " srt ",
    isText: true,
    contentUrl: "/api/media/subtitles/en.srt",
    isForced: true,
    isHearingImpaired: true,
    isDefault: true,
    isExternal: true,
  } satisfies PlaybackSubtitleTrack;

  assert.equal(
    formatSubtitleTrackLabel(track, { variant: "selector" }),
    "English SDH (EN | SRT | Forced · SDH · Default · External)",
  );
  assert.equal(
    formatSubtitleTrackLabel(track, { variant: "summary" }),
    "English SDH",
  );
  assert.equal(
    formatSubtitleTrackLabel(track, { variant: "timeline" }),
    "English SDH / EN",
  );
  assert.equal(
    formatSubtitleTrackTechnicalSummary(track),
    "SRT · EN · Forced · SDH",
  );
});

void test("formats fallback subtitle track labels consistently", () => {
  assert.equal(
    formatSubtitleTrackLabel({ languageCode: "es" }, { variant: "selector" }),
    "ES (Unsupported)",
  );
  assert.equal(
    formatSubtitleTrackLabel({ languageCode: "es" }, { variant: "summary" }),
    "ES",
  );
  assert.equal(
    formatSubtitleTrackLabel({ languageCode: "es" }, { variant: "timeline" }),
    "ES",
  );
  assert.equal(
    formatSubtitleTrackLabel({}, { variant: "selector" }),
    "Unnamed subtitle track (Unsupported)",
  );
  assert.equal(
    formatSubtitleTrackLabel({}, { variant: "summary" }),
    "Selected subtitle track",
  );
  assert.equal(
    formatSubtitleTrackLabel({}, { variant: "timeline" }),
    "Subtitle track",
  );
});
