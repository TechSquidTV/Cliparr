import assert from "node:assert/strict";
import test from "node:test";
import { seekCaptureFrame } from "@/components/editor/useEditorAssetCapture";

void test("capture seeking pauses playback and uses the media adapter", () => {
  const calls: (string | number)[] = [];
  const media = {
    metadataReady: true,
    duration: 1000,
    pausePlayback: () => {
      calls.push("pause");
    },
    seekToTime: (seconds: number) => {
      calls.push(seconds);
    },
  };
  seekCaptureFrame(media, 496.72);
  assert.deepEqual(calls, ["pause", 496.72]);
  for (const seconds of [-1, NaN, Infinity, 1000, 1001]) {
    assert.throws(() => seekCaptureFrame(media, seconds));
  }
  assert.throws(() => seekCaptureFrame({ ...media, metadataReady: false }, 0));
  assert.deepEqual(calls, ["pause", 496.72]);
});
