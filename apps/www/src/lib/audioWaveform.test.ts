import assert from "node:assert/strict";
import test from "node:test";
import { audioWaveformPeaks, waveformBarCount } from "@/lib/audioWaveform";

void test("waveform includes both channels and the last sample", () => {
  const left = new Float32Array(waveformBarCount * 2 + 1);
  const right = new Float32Array(left.length);
  left[0] = -0.25;
  right[right.length - 1] = -0.5;
  const peaks = audioWaveformPeaks([left, right]);

  assert.equal(peaks.length, waveformBarCount);
  assert.equal(peaks[0], 0.5);
  assert.equal(peaks.at(-1), 1);
  assert.ok(peaks.slice(1, -1).every((peak) => peak === 0));
});

void test("silence and empty audio stay finite and flat", () => {
  for (const channels of [[], [new Float32Array(100)]]) {
    assert.ok(audioWaveformPeaks(channels).every((peak) => peak === 0));
  }
});
