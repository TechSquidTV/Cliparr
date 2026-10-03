import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  type AudioCodec,
} from "mediabunny";
import { registerAc3Encoder } from "@mediabunny/ac3";
import { ensureAudioEncoder } from "#/lib/mediabunnyCodecs";

/** Generated in an isolated browser context, never the context measuring downloads. */
export async function createMediaLoadingFixtures() {
  registerAc3Encoder();
  await ensureAudioEncoder("aac");
  const fixtures: { name: string; bytes: number[] }[] = [];
  for (const codecs of [
    ["aac"],
    ["ac3"],
    ["eac3"],
    ["aac", "ac3"],
  ] satisfies AudioCodec[][]) {
    const canvas = new OffscreenCanvas(160, 90);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Missing fixture canvas context");
    }
    const target = new BufferTarget();
    const output = new Output({ target, format: new Mp4OutputFormat() });
    // VP9 decoding works in software Chrome on CI as well as local machines.
    const video = new CanvasSource(canvas, { codec: "vp9", bitrate: 100_000 });
    output.addVideoTrack(video, { frameRate: 12 });
    const audio = codecs.map((codec) => {
      const source = new AudioSampleSource({ codec, bitrate: 96_000 });
      output.addAudioTrack(source, { name: codec });
      return source;
    });
    const sample = new AudioSample({
      data: Float32Array.from(
        { length: 48_000 },
        (_, index) => 0.1 * Math.sin((2 * Math.PI * 440 * index) / 48_000),
      ),
      format: "f32",
      sampleRate: 48_000,
      numberOfChannels: 1,
      timestamp: 0,
    });
    try {
      await output.start();
      await Promise.all([
        ...audio.map(async (source) => {
          await source.add(sample);
          source.close();
        }),
        (async () => {
          for (let frame = 0; frame < 12; frame++) {
            context.fillStyle = frame % 2 === 0 ? "#225599" : "#992255";
            context.fillRect(0, 0, canvas.width, canvas.height);
            await video.add(frame / 12, 1 / 12);
          }
          video.close();
        })(),
      ]);
      await output.finalize();
      if (!target.buffer) {
        throw new Error("Missing loading fixture output");
      }
      fixtures.push({
        name: `${codecs.join("-")}.mp4`,
        bytes: [...new Uint8Array(target.buffer)],
      });
    } finally {
      sample.close();
      if (output.state !== "finalized") {
        await output.cancel();
      }
    }
  }
  return fixtures;
}
