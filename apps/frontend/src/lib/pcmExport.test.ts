import assert from "node:assert/strict";
import test from "node:test";
import { exportClip } from "#/lib/exportClip";
import { createPcmWav } from "#/lib/exportAudioFixtures.test-support";

for (const bits of [8, 16, 24, 32] as const) {
  void test(`real WAV trimming preserves ${bits}-bit PCM, including silence and extrema`, async () => {
    const samples =
      bits === 8
        ? [0, 128, 128, 255, 1, 127, 129, 64, 255]
        : [
            0,
            1,
            -1,
            2 ** (bits - 2) + 1,
            -(2 ** (bits - 2)) - 1,
            2 ** (bits - 1) - 1,
            -(2 ** (bits - 1)),
            0,
          ];
    const file = createPcmWav({ bits, samples });
    const outputBits = Math.max(16, bits);
    const bytesPerSample = outputBits / 8;
    const expected = samples
      .slice(1, -1)
      .map((value) => (bits === 8 ? (value - 128) * 256 : value));
    for (let attempt = 0; attempt < 2; attempt++) {
      const output = await exportClip({
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
        startTime: 1 / 48_000,
        endTime: (samples.length - 1) / 48_000,
        title: "Local",
        onProgress: () => {},
      });
      const bytes = new Uint8Array(await output.arrayBuffer());
      const view = new DataView(bytes.buffer);
      let found = false;
      for (let position = 12; position + 8 <= bytes.length; ) {
        const length = view.getUint32(position + 4, true);
        if (
          new TextDecoder().decode(bytes.subarray(position, position + 4)) ===
          "data"
        ) {
          const actual = Array.from(
            { length: length / bytesPerSample },
            (_, index) => {
              const offset = position + 8 + index * bytesPerSample;
              let value = 0;
              for (let byte = 0; byte < bytesPerSample; byte++) {
                value += bytes[offset + byte] * 2 ** (byte * 8);
              }
              return value >= 2 ** (outputBits - 1)
                ? value - 2 ** outputBits
                : value;
            },
          );
          assert.deepEqual(actual, expected);
          found = true;
        }
        position += 8 + length + (length % 2);
      }
      assert.equal(found, true);
      assert.match(
        new TextDecoder().decode(bytes),
        /CLIPARR_SOURCE_START_SECONDS/,
      );
    }
  });
}
