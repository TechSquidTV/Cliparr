import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildLocalFileSource,
  type SourceProbeResult,
} from "@/components/convert/convertToolUtilities";
import { MediabunnySourcePreview } from "@/components/convert/MediabunnySourcePreview";

function renderPreview(
  probe: SourceProbeResult | null,
  inspectionError: string | null = null,
) {
  return renderToStaticMarkup(
    createElement(MediabunnySourcePreview, {
      source: buildLocalFileSource(
        new File([], "source.mp4", { type: "video/mp4" }),
      ),
      probe,
      inspectionError,
      canSelectFile: true,
      dragActive: false,
      onDragActiveChange: () => {},
      onDropFile: () => {},
    }),
  );
}

void test("audio-only inspection is ready without video preview metadata", () => {
  for (const hasVideo of [false, true]) {
    const markup = renderPreview({
      durationSeconds: 2,
      previewStartTimestampSeconds: 0,
      dimensions: null,
      hasAudio: true,
      hasVideo,
    });
    assert.match(markup, /Audio ready for export/);
    assert.doesNotMatch(
      markup,
      /role="alert"|Loading preview|aria-busy="true"/,
    );
  }
});

void test("failed inspection ends preview loading", () => {
  const markup = renderPreview(null, "Unsupported media");
  assert.match(markup, /Preview unavailable/);
  assert.doesNotMatch(markup, /Loading preview|Audio ready for export/);
});
