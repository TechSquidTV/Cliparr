import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSubtitleExportSummary } from "@/components/editor/subtitleExportSummary";

void test("authored cues are included without provider metadata", () => {
  assert.deepEqual(
    buildSubtitleExportSummary({
      subtitleEnabled: true,
      clippedSubtitleCueCount: 2,
      subtitleLoading: false,
    }),
    {
      label: "Included",
      detail: "2 subtitles will be burned in.",
      tone: "ready",
      disabledReason: null,
    },
  );
});
void test("hidden and out-of-range subtitles do not block exports", () => {
  const hidden = buildSubtitleExportSummary({
    subtitleEnabled: false,
    clippedSubtitleCueCount: 2,
    subtitleLoading: false,
  });
  assert.equal(hidden.label, "Not included");
  assert.equal(hidden.disabledReason, null);
  const empty = buildSubtitleExportSummary({
    subtitleEnabled: true,
    clippedSubtitleCueCount: 0,
    subtitleLoading: false,
  });
  assert.equal(empty.label, "None in range");
  assert.equal(empty.disabledReason, null);
});
void test("pending imports block export even when existing subtitles are hidden", () => {
  for (const subtitleEnabled of [true, false]) {
    const result = buildSubtitleExportSummary({
      subtitleEnabled,
      clippedSubtitleCueCount: 1,
      subtitleLoading: true,
    });
    assert.equal(result.label, "Importing");
    assert.equal(result.disabledReason, "Subtitles are still loading.");
  }
});
