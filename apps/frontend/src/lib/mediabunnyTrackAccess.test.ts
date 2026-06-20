import assert from "node:assert/strict";
import test from "node:test";
import {
  videoTrackExportUnsupportedMessage,
  videoTrackPreviewUnavailableMessage,
  type VideoTrackDecodabilityAssessment,
} from "@/lib/mediabunnyTrackAccess";

void test("formats unsupported video track messages for preview and export contexts", () => {
  const unsupportedVp9 = {
    codec: "vp9",
    canDecode: false,
  } satisfies VideoTrackDecodabilityAssessment;

  assert.equal(
    videoTrackPreviewUnavailableMessage(unsupportedVp9),
    "Preview unavailable: this browser cannot decode vp9 video.",
  );
  assert.equal(
    videoTrackExportUnsupportedMessage(unsupportedVp9),
    "This browser cannot decode vp9 video. Try Chrome or Edge, or use a source video codec this browser supports.",
  );
});

void test("formats unknown video codec messages for preview and export contexts", () => {
  const unknownCodec = {
    codec: null,
    canDecode: false,
  } satisfies VideoTrackDecodabilityAssessment;

  assert.equal(
    videoTrackPreviewUnavailableMessage(unknownCodec),
    "Preview unavailable: this browser cannot decode the source video track because its codec is unknown.",
  );
  assert.equal(
    videoTrackExportUnsupportedMessage(unknownCodec),
    "This browser cannot decode the source video track because its codec is unknown.",
  );
});
