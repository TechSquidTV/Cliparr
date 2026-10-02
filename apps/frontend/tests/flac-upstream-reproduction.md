# Standalone FLAC final-frame reproduction

Prepared for an upstream report; not published. Reproduced with MediaBunny and
`@mediabunny/flac-encoder` 1.61.0 in Chrome. Run this in a browser project with
those two packages installed and worker/WASM bundling enabled.

```ts
import {
  AudioSample,
  AudioSampleSource,
  AudioSampleSink,
  BlobSource,
  BufferTarget,
  EncodedPacketSink,
  FLAC,
  FlacOutputFormat,
  Input,
  Output,
} from "mediabunny";
import { registerFlacEncoder } from "@mediabunny/flac-encoder";

registerFlacEncoder();
const target = new BufferTarget();
const output = new Output({ target, format: new FlacOutputFormat() });
const source = new AudioSampleSource({ codec: "flac" });
output.addAudioTrack(source);
await output.start();
const sample = new AudioSample({
  data: Int16Array.from({ length: 8192 }, (_, i) =>
    i >= 4096 ? 0 : (i % 257) * 17 - 2048,
  ),
  format: "s16",
  sampleRate: 8000,
  numberOfChannels: 1,
  timestamp: 0,
});
try {
  await source.add(sample);
} finally {
  sample.close();
}
source.close();
await output.finalize();
if (!target.buffer) throw new Error("Missing output");
const bytes = target.buffer;
const native = await new OfflineAudioContext(1, 8192, 8000).decodeAudioData(
  bytes.slice(0),
);
const input = new Input({
  source: new BlobSource(new Blob([bytes])),
  formats: [FLAC],
});
try {
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error("Missing track");
  const packet = await new EncodedPacketSink(track).getPacket(
    1.024 - 0.5 / 8000,
    { metadataOnly: true },
  );
  let frames = 0;
  for await (const decoded of new AudioSampleSink(track).samples()) {
    frames += decoded.numberOfFrames;
    decoded.close();
  }
  document.body.textContent = JSON.stringify({
    nativeFrames: native.length,
    declaredDuration: await track.getDurationFromMetadata(),
    readableEnd: packet ? packet.timestamp + packet.duration : null,
    decodedFrames: frames,
  });
} finally {
  input.dispose();
}
```

Expected: 8192 frames and a readable end of 1.024 seconds. Observed: native Chrome
reads all 8192 frames, metadata declares 1.024 seconds, but MediaBunny exposes
4096 frames and a readable end of 0.512 seconds. The missing constant final frame
is shorter than the native FLAC reader's 16-byte minimum header request.

This concerns standalone FLAC demuxing, not all containers carrying FLAC audio.
Cliparr checks the requested source interval using public packet metadata and
refuses an incomplete export. It neither repairs bytes nor substitutes a decoder.
