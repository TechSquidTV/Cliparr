import assert from "node:assert/strict";
import test from "node:test";

import {
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
  StreamTarget,
} from "mediabunny";

import { createExportTarget } from "#/lib/export/exportFileTarget";

function fileDestination() {
  let bytes: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  let committed = false;
  let aborted = false;
  const positions: number[] = [];
  const stream = Object.assign(new WritableStream<FileSystemWriteChunkType>(), {
    write: async (chunk: FileSystemWriteChunkType) => {
      assert.ok(
        typeof chunk === "object" &&
          chunk !== null &&
          "type" in chunk &&
          "data" in chunk &&
          "position" in chunk,
      );
      assert.equal(chunk.type, "write");
      assert.ok(chunk.data instanceof Uint8Array);
      const position = chunk.position ?? 0;
      positions.push(position);
      const next = new Uint8Array(
        Math.max(bytes.length, position + chunk.data.byteLength),
      );
      next.set(bytes);
      next.set(chunk.data, position);
      bytes = next;
    },
    seek: async (_position: number) => {},
    truncate: async (_size: number) => {},
    close: async () => {
      committed = true;
    },
    abort: async () => {
      aborted = true;
    },
  });
  return {
    handle: {
      createWritable: async () => stream,
      getFile: async () => new File([bytes], "clip.mp4", { type: "video/mp4" }),
    },
    get committed() {
      return committed;
    },
    get aborted() {
      return aborted;
    },
    positions,
  };
}
function rejectBufferTarget(): BufferTarget {
  throw new Error("Disk exports must never allocate a BufferTarget");
}

async function finalizeMp4(
  target: Awaited<ReturnType<typeof createExportTarget>>,
) {
  const output = new Output({
    target: target.target,
    format: new Mp4OutputFormat({ fastStart: false, onMoov: target.onMoov }),
  });
  const audio = new EncodedAudioPacketSource("aac");
  output.addAudioTrack(audio);
  await output.start();
  await audio.add(
    new EncodedPacket(new Uint8Array([1, 2, 3]), "key", 0, 1024 / 48_000),
    {
      decoderConfig: {
        codec: "mp4a.40.2",
        sampleRate: 48_000,
        numberOfChannels: 2,
        description: new Uint8Array([0x11, 0x90]),
      },
    },
  );
  audio.close();
  await output.finalize();
}

void test("streams a seekable MP4 and commits metadata without a full-file buffer", async () => {
  const destination = fileDestination();
  let metadataPatched = false;
  const target = await createExportTarget(
    destination.handle,
    rejectBufferTarget,
    () => {
      metadataPatched = true;
    },
  );
  assert.ok(target.target instanceof StreamTarget);
  await finalizeMp4(target);
  assert.equal(destination.committed, false);
  assert.equal(metadataPatched, true);
  const file = await target.finish("video/mp4", true);
  assert.equal(destination.committed, true);
  assert.ok(file.size > 3);
  assert.ok(destination.positions.length > 1);
  const input = new Input({ source: new BlobSource(file), formats: [MP4] });
  try {
    const track = await input.getPrimaryAudioTrack();
    assert.equal(await track?.getCodec(), "aac");
  } finally {
    input.dispose();
  }
  await target.abort();
  assert.equal(destination.aborted, false);
});

void test("aborts an unfinished native file without committing it", async () => {
  const destination = fileDestination();
  const target = await createExportTarget(
    destination.handle,
    rejectBufferTarget,
  );
  await target.abort();
  assert.equal(destination.aborted, true);
  assert.equal(destination.committed, false);
});

void test("keeps the Blob output on browsers without a file destination", async () => {
  const target = await createExportTarget(undefined, () => new BufferTarget());
  assert.ok(target.target instanceof BufferTarget);
  await finalizeMp4(target);
  const blob = await target.finish("video/mp4", true);
  assert.equal(blob.type, "video/mp4");
  assert.ok(blob.size > 3);
});

void test("does not commit when cancellation arrives before native finalization", async () => {
  const destination = fileDestination();
  const target = await createExportTarget(
    destination.handle,
    rejectBufferTarget,
  );
  await finalizeMp4(target);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(target.finish("video/mp4", true, controller.signal), {
    name: "AbortError",
  });
  await target.abort();
  assert.equal(destination.committed, false);
  assert.equal(destination.aborted, true);
});
