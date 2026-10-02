import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AudioSampleSink, BlobSource, Input, WAVE } from "mediabunny";
import { exportClip } from "#/lib/exportClip";
import { createPcmWav } from "#/lib/exportAudioFixtures.test-support";

async function exportWav(file: File, startFrame: number, endFrame: number) {
  const blob = await exportClip({
    mediaSource: {
      kind: "file",
      role: "local-file",
      label: "Local",
      file,
      fileName: file.name,
    },
    format: "wav",
    mode: "audio-only",
    resolution: "original",
    startTime: startFrame / 48_000,
    endTime: endFrame / 48_000,
    onProgress: () => {},
  });
  const input = new Input({ source: new BlobSource(blob), formats: [WAVE] });
  try {
    const track = await input.getPrimaryAudioTrack();
    assert.ok(track);
    const values: number[] = [];
    for await (const sample of new AudioSampleSink(track).samples()) {
      try {
        // Integer inspection avoids losing precision in our test's assertions.
        const data = new Int32Array(sample.numberOfFrames);
        sample.copyTo(data, { format: "s32", planeIndex: 0 });
        values.push(...data);
      } finally {
        sample.close();
      }
    }
    return { codec: await track.getCodec(), values };
  } finally {
    input.dispose();
  }
}

void test("audio-only export applies the selected trim and automatic source precision", async () => {
  const samples = [0, 8192, 16_384, -8192, 0];
  const file = await createPcmWav({ samples });
  const output = await exportWav(file, 1, 4);
  assert.equal(output.codec, "pcm-s16");
  assert.deepEqual(
    output.values,
    samples.slice(1, 4).map((value) => value * 65_536),
  );
});

void test("audio-only export preserves known 32-bit source values through sample preparation", async () => {
  const bytes = await readFile(
    new URL("fixtures/precision-32.wav", import.meta.url),
  );
  const file = new File([new Uint8Array(bytes)], "precision-32.wav", {
    type: "audio/wav",
  });
  const output = await exportWav(file, 1, 7);
  assert.equal(output.codec, "pcm-s32");
  assert.deepEqual(
    output.values,
    [1, -1, 1_073_741_825, -1_073_741_825, 2_147_483_647, -2_147_483_648],
  );
});
