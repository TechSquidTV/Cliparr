/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import type { SubtitleCue } from "#/lib/subtitles/types";
import {
  buildTranscript,
  MAX_TRANSCRIPT_LENGTH,
} from "@/lib/metadata/transcript";

function cue(text: string): SubtitleCue {
  return { startTime: 0, endTime: 1, text, lines: [text] };
}

void test("joins clipped cue texts with newlines", () => {
  const transcript = buildTranscript([
    cue("You were the one who knocked."),
    cue("  "),
    cue("Say my name."),
  ]);

  assert.equal(transcript, "You were the one who knocked.\nSay my name.");
});

void test("returns undefined for empty or whitespace-only cues", () => {
  assert.equal(buildTranscript([]), undefined);
  assert.equal(buildTranscript([cue("   "), cue("\n")]), undefined);
});

void test("caps the transcript at the max length", () => {
  const long = "a".repeat(MAX_TRANSCRIPT_LENGTH + 100);
  const transcript = buildTranscript([cue(long)]);

  assert.equal(transcript?.length, MAX_TRANSCRIPT_LENGTH);
});

void test("respects a custom max length", () => {
  const transcript = buildTranscript([cue("hello world")], 5);

  assert.equal(transcript, "hello");
});

void test("omits the transcript for a zero-length budget", () => {
  assert.equal(buildTranscript([cue("hello")], 0), undefined);
});

void test("does not split Unicode characters at the length limit", () => {
  assert.equal(buildTranscript([cue("ab🎬cd")], 3), "ab");
  assert.equal(buildTranscript([cue("ab🎬cd")], 4), "ab🎬");
});
