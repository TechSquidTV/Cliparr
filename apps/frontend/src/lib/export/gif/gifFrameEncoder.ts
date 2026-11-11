import type { FrameChunk } from "@techsquidtv/gifenc";

import {
  createGifFrameChunkEncoder,
  type EncodeGifFrameChunkInput,
} from "#/lib/export/gif/gifFrameChunk";

interface GifFrameEncodeInput extends Omit<EncodeGifFrameChunkInput, "rgba"> {
  imageData: ImageData;
}

interface GifFrameEncoder {
  concurrency: number;
  // Consumes the frame data; worker encoding transfers its entire backing buffer.
  encodeFrame(input: GifFrameEncodeInput): Promise<FrameChunk>;
  dispose(): void;
}

interface GifFrameEncoderOptions {
  requiresSequentialFrames?: boolean;
}

export interface GifFrameWorkerEncodeRequest extends Omit<
  GifFrameEncodeInput,
  "imageData"
> {
  type: "encode-frame";
  id: number;
  rgba: Uint8ClampedArray;
}

export type GifFrameWorkerEncodeResponse =
  | {
      type: "encoded-frame";
      id: number;
      chunk: FrameChunk;
    }
  | {
      type: "error";
      id: number;
      message: string;
    };

export function createBestGifFrameEncoder(
  options: GifFrameEncoderOptions = {},
) {
  return (
    createGifFrameWorkerEncoder({
      workerCount: options.requiresSequentialFrames ? 1 : undefined,
    }) ?? createInlineGifFrameEncoder()
  );
}

function createInlineGifFrameEncoder(): GifFrameEncoder {
  const chunks = createGifFrameChunkEncoder();

  return {
    concurrency: 1,
    async encodeFrame({ imageData, ...settings }) {
      return chunks.encode({
        ...settings,
        rgba: imageData.data,
      });
    },
    dispose() {
      chunks.dispose();
    },
  };
}

function createGifFrameWorkerEncoder({
  createWorker = createGifFrameWorker,
  workerCount,
}: {
  createWorker?: () => Worker;
  workerCount?: number;
} = {}): GifFrameEncoder | null {
  if (createWorker === createGifFrameWorker && typeof Worker === "undefined") {
    return null;
  }

  const resolvedWorkerCount = defaultGifFrameWorkerCount(workerCount);
  const workers: Worker[] = [];

  try {
    for (let index = 0; index < resolvedWorkerCount; index += 1) {
      workers.push(createWorker());
    }
  } catch {
    for (const worker of workers) {
      worker.terminate();
    }

    return null;
  }

  let disposed = false;
  let nextRequestId = 1;
  let nextWorkerIndex = 0;
  const pendingRequests = new Map<
    number,
    {
      resolve: (chunk: FrameChunk) => void;
      reject: (error: Error) => void;
    }
  >();

  const rejectPendingRequests = (error: Error) => {
    for (const pendingRequest of pendingRequests.values()) {
      pendingRequest.reject(error);
    }
    pendingRequests.clear();
  };

  const handleMessage = (event: MessageEvent<GifFrameWorkerEncodeResponse>) => {
    const message = event.data;
    const pendingRequest = pendingRequests.get(message.id);
    if (!pendingRequest) {
      return;
    }

    pendingRequests.delete(message.id);

    if (message.type === "error") {
      pendingRequest.reject(new Error(message.message));
      return;
    }

    pendingRequest.resolve(message.chunk);
  };
  const handleError = (event: ErrorEvent) => {
    rejectPendingRequests(
      new Error(event.message || "GIF frame worker failed."),
    );
  };
  const handleMessageError = () => {
    rejectPendingRequests(
      new Error("GIF frame worker sent an unreadable response."),
    );
  };

  for (const worker of workers) {
    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    worker.addEventListener("messageerror", handleMessageError);
  }

  return {
    concurrency: workers.length,
    encodeFrame({ imageData, ...settings }) {
      if (disposed) {
        return Promise.reject(new Error("GIF frame encoder was disposed."));
      }

      const worker = workers[nextWorkerIndex];
      nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;
      const id = nextRequestId;
      nextRequestId += 1;
      const rgba = imageData.data;
      const buffer = rgba.buffer;
      if (!(buffer instanceof ArrayBuffer) || rgba.byteLength === 0) {
        return Promise.reject(
          new Error("GIF frame data must have an attached ArrayBuffer."),
        );
      }

      return new Promise<FrameChunk>((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject });
        try {
          worker.postMessage(
            {
              type: "encode-frame",
              id,
              ...settings,
              rgba,
            } satisfies GifFrameWorkerEncodeRequest,
            [buffer],
          );
        } catch (error) {
          pendingRequests.delete(id);
          reject(
            error instanceof Error
              ? error
              : new Error("GIF frame worker could not receive frame data."),
          );
        }
      });
    },
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      for (const worker of workers) {
        worker.removeEventListener("message", handleMessage);
        worker.removeEventListener("error", handleError);
        worker.removeEventListener("messageerror", handleMessageError);
        worker.terminate();
      }
      rejectPendingRequests(new Error("GIF frame encoder was disposed."));
    },
  };
}

function createGifFrameWorker() {
  return new Worker(new URL("gifFrameEncoder.worker.ts", import.meta.url), {
    type: "module",
  });
}

export function defaultGifFrameWorkerCount(workerCount?: number) {
  if (typeof workerCount === "number" && Number.isFinite(workerCount)) {
    return Math.max(1, Math.min(4, Math.floor(workerCount)));
  }

  const hardwareConcurrency = globalThis.navigator?.hardwareConcurrency;
  if (typeof hardwareConcurrency !== "number" || hardwareConcurrency <= 1) {
    return 1;
  }

  return Math.max(1, Math.min(4, hardwareConcurrency - 1));
}
