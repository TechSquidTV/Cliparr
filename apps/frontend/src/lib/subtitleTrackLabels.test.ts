/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { subtitleTrackLabelParts } from "@/lib/subtitleTrackLabels";
import type { PlaybackSubtitleTrack } from "@/providers/types";

void test("preserves subtitle language, format, and flags as separate details", () => {
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

  assert.deepEqual(subtitleTrackLabelParts(track), {
    title: "English SDH",
    language: "EN",
    codec: "SRT",
    flags: ["Forced", "SDH", "Default", "External"],
  });
});

void test("handles missing and blank subtitle metadata without empty labels", () => {
  assert.deepEqual(subtitleTrackLabelParts({ languageCode: "es" }), {
    title: undefined,
    language: "ES",
    codec: undefined,
    flags: ["Unsupported"],
  });
  assert.deepEqual(subtitleTrackLabelParts({ title: " ", codec: " " }), {
    title: undefined,
    language: undefined,
    codec: undefined,
    flags: ["Unsupported"],
  });
});
