/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSubtitleCueText } from "@/lib/subtitles/normalizeSubtitleCueText";

void test("normalizes subtitle text and lines from one canonical value", () => {
  assert.deepEqual(
    normalizeSubtitleCueText("  First line  \r\n\r\n Second line\t"),
    {
      text: "First line\nSecond line",
      lines: ["First line", "Second line"],
    },
  );
});

void test("rejects subtitle text containing only whitespace", () => {
  assert.equal(normalizeSubtitleCueText(" \n\t\r\n "), null);
});
