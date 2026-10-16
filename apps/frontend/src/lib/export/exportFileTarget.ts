import {
  type BufferTarget,
  StreamTarget,
  type StreamTargetChunk,
} from "mediabunny";

import { patchMp4MetadataBoxes } from "#/lib/export/exportMetadata";

interface ExportTarget {
  target: BufferTarget | StreamTarget;
  onMoov?: (data: Uint8Array, position: number) => void;
  finish: (
    mimeType: string,
    patchMp4: boolean,
    signal?: AbortSignal,
  ) => Promise<Blob>;
  abort: () => Promise<void>;
}

export async function createExportTarget(
  handle: Pick<FileSystemFileHandle, "createWritable" | "getFile"> | undefined,
  createBufferTarget: () => BufferTarget,
  patchMetadata = patchMp4MetadataBoxes,
): Promise<ExportTarget> {
  if (!handle) {
    const target = createBufferTarget();
    return {
      target,
      finish: async (mimeType, patchMp4) => {
        if (!target.buffer) {
          throw new Error("Export did not produce a media buffer");
        }
        if (patchMp4) {
          patchMetadata(new Uint8Array(target.buffer));
        }
        return new Blob([target.buffer], { type: mimeType });
      },
      abort: async () => {},
    };
  }
  const file = await handle.createWritable();
  let committed = false;
  let metadata: StreamTargetChunk | null = null;
  // Mediabunny owns the wrapper. Only finish() commits the native file, so
  // Output.cancel() cannot publish partial output by closing its target.
  const writable = new WritableStream<StreamTargetChunk>({
    write: (chunk) => file.write(chunk),
  });
  return {
    target: new StreamTarget(writable, {
      chunked: true,
      chunkSize: 1024 * 1024,
    }),
    onMoov: (data, position) => {
      const bytes = new Uint8Array(data);
      patchMetadata(bytes);
      metadata = { type: "write", data: bytes, position };
    },
    finish: async (_mimeType, _patchMp4, signal) => {
      if (metadata) {
        await file.write(metadata);
      }
      signal?.throwIfAborted();
      await file.close();
      committed = true;
      // File is a disk-backed Blob; reading its size does not load the media.
      return handle.getFile();
    },
    abort: async () => {
      if (!committed) {
        await file.abort();
      }
    },
  };
}
