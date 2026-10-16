import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ConvertExportSummary } from "@/components/convert/ConvertExportSummary";

void test("converter summaries compose common output rows without editor details", () => {
  for (const selectedFormat of ["mp4", "mp3", "wav", "gif"] as const) {
    const markup = renderToStaticMarkup(
      createElement(ConvertExportSummary, {
        title: "Example",
        duration: 15.25,
        selectedFormat,
        selectedQuality: "sharp",
        outputDimensions: { width: 1920, height: 1080 },
        mode:
          selectedFormat === "mp3" || selectedFormat === "wav"
            ? "audio-only"
            : "video-audio",
        audioStatus: "Stereo",
        audioPlan: null,
      }),
    );
    assert.match(markup, />Duration<\/dt>/);
    assert.match(markup, /0:15\.25/);
    assert.match(markup, />Output<\/dt>/);
    assert.doesNotMatch(markup, />(Clip|Source|Subtitles|Filename)<\/dt>/);
    assert.equal(markup.includes(">Audio</dt>"), selectedFormat === "mp4");
  }
});
