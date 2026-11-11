import { createGifFrameChunkEncoder } from "#/lib/export/gif/gifFrameChunk";
import type {
  GifFrameWorkerEncodeRequest,
  GifFrameWorkerEncodeResponse,
} from "#/lib/export/gif/gifFrameEncoder";

type GifFrameWorkerGlobal = {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<GifFrameWorkerEncodeRequest>) => void,
  ): void;
  postMessage(
    message: GifFrameWorkerEncodeResponse,
    transfer?: Transferable[],
  ): void | boolean;
};

const workerScope = globalThis as unknown as GifFrameWorkerGlobal;
let chunks: ReturnType<typeof createGifFrameChunkEncoder> | undefined;

workerScope.addEventListener("message", (event) => {
  const message = event.data;

  try {
    if (message.job) {
      chunks = createGifFrameChunkEncoder(message.job);
    }
    if (!chunks) {
      throw new Error("GIF frame worker has no encoder settings.");
    }
    const chunk = chunks.encode(message);
    const buffer = chunk.bytes.buffer;
    if (!(buffer instanceof ArrayBuffer)) {
      throw new TypeError("GIF frame chunk must have a transferable buffer.");
    }
    workerScope.postMessage({ type: "encoded-frame", chunk }, [buffer]);
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      sequenceIndex: message.sequenceIndex,
      message:
        error instanceof Error ? error.message : "GIF frame encoding failed.",
    });
  }
});
