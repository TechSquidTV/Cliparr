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
const chunks = createGifFrameChunkEncoder();

workerScope.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type !== "encode-frame") {
    return;
  }

  try {
    const chunk = chunks.encode(message);
    const buffer = chunk.bytes.buffer;
    if (!(buffer instanceof ArrayBuffer)) {
      throw new TypeError("GIF frame chunk must have a transferable buffer.");
    }
    workerScope.postMessage({ type: "encoded-frame", id: message.id, chunk }, [
      buffer,
    ]);
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      id: message.id,
      message:
        error instanceof Error ? error.message : "GIF frame encoding failed.",
    });
  }
});
