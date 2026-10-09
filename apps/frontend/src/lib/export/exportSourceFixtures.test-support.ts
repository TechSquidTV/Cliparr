import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  CmafOutputFormat,
  FlacOutputFormat,
  HlsOutputFormat,
  Mp4OutputFormat,
  MkvOutputFormat,
  type OutputFormat,
  Output,
  PathedTarget,
} from "mediabunny";
import { ensureAudioEncoder } from "#/lib/export/mediabunny/mediabunnyCodecs";

/** A valid FLAC whose constant final frame triggers the released reader's tail loss. */
async function createFlacTailFixture(
  format: OutputFormat = new FlacOutputFormat(),
) {
  await ensureAudioEncoder("flac");
  const target = new BufferTarget();
  const output = new Output({ target, format });
  const source = new AudioSampleSource({ codec: "flac" });
  output.addAudioTrack(source);
  const sample = new AudioSample({
    data: Int16Array.from({ length: 8192 }, (_, index) =>
      index >= 4096 ? 0 : (index % 257) * 17 - 2048,
    ),
    format: "s16",
    numberOfChannels: 1,
    sampleRate: 8000,
    timestamp: 0,
  });
  try {
    await output.start();
    await source.add(sample);
    source.close();
    await output.finalize();
    if (!target.buffer) {
      throw new Error("Missing FLAC fixture");
    }
    return target.buffer;
  } finally {
    sample.close();
    if (output.state !== "finalized") {
      await output.cancel();
    }
  }
}

export async function createBrowserSourceFixtures() {
  const canvas = new OffscreenCanvas(3, 2);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Missing artwork fixture context");
  }
  context.fillStyle = "#ff0000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const artwork = await canvas.convertToBlob({ type: "image/webp" });
  if (artwork.type !== "image/webp") {
    throw new Error("Artwork fixture must exercise WebP normalization");
  }
  const artworkBytes = new Uint8Array(await artwork.arrayBuffer());
  const flac = await createFlacTailFixture();
  const mp4 = await createFlacTailFixture(new Mp4OutputFormat());
  const mkv = await createFlacTailFixture(new MkvOutputFormat());
  await ensureAudioEncoder("aac");
  const targets = new Map<string, BufferTarget>();
  const output = new Output({
    target: new PathedTarget("fixtures/master.m3u8", ({ path }) => {
      const target = new BufferTarget();
      targets.set(path, target);
      return target;
    }),
    format: new HlsOutputFormat({
      segmentFormat: new CmafOutputFormat(),
      targetDuration: 0.5,
    }),
  });
  const source = new AudioSampleSource({ codec: "aac", bitrate: 96_000 });
  output.addAudioTrack(source, { isRelativeToUnixEpoch: true });
  const sample = new AudioSample({
    data: Float32Array.from(
      { length: 96_000 },
      (_, index) => 0.25 * Math.sin((2 * Math.PI * 440 * index) / 48_000),
    ),
    format: "f32",
    sampleRate: 48_000,
    numberOfChannels: 1,
    timestamp: 60,
  });
  try {
    await output.start();
    await source.add(sample);
    source.close();
    await output.finalize();
    return [
      { path: "fixtures/artwork.webp", data: [...artworkBytes] },
      { path: "fixtures/tail.flac", data: [...new Uint8Array(flac)] },
      { path: "fixtures/tail.mp4", data: [...new Uint8Array(mp4)] },
      { path: "fixtures/tail.mkv", data: [...new Uint8Array(mkv)] },
      ...[...targets].map(([path, target]) => {
        if (!target.buffer) {
          throw new Error("Missing HLS fixture");
        }
        return { path, data: [...new Uint8Array(target.buffer)] };
      }),
    ];
  } finally {
    sample.close();
    if (output.state !== "finalized") {
      await output.cancel();
    }
  }
}
