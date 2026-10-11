import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  Output,
  WavOutputFormat,
} from "mediabunny";

/** Generate input media for Cliparr integration tests using public MediaBunny APIs. */
export async function createPcmWav({
  bits = 16,
  samples,
  sampleRate = 48_000,
  channels = 1,
}: {
  bits?: 8 | 16;
  samples: readonly number[];
  sampleRate?: number;
  channels?: number;
}) {
  const target = new BufferTarget();
  const output = new Output({ target, format: new WavOutputFormat() });
  const source = new AudioSampleSource({
    codec: bits === 8 ? "pcm-u8" : "pcm-s16",
  });
  output.addAudioTrack(source);
  const sample = new AudioSample({
    data: bits === 8 ? new Uint8Array(samples) : new Int16Array(samples),
    format: bits === 8 ? "u8" : "s16",
    sampleRate,
    numberOfChannels: channels,
    timestamp: 0,
  });
  try {
    await output.start();
    await source.add(sample);
    source.close();
    await output.finalize();
    if (!target.buffer) {
      throw new Error("Could not create the audio fixture.");
    }
    return new File([target.buffer], "source.wav", { type: "audio/wav" });
  } finally {
    sample.close();
  }
}
