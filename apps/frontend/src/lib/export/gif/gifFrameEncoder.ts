import type { FrameChunk } from "@techsquidtv/gifenc";

import {
  createGifFrameChunkEncoder,
  type GifEncoderJob,
  type GifFrameInput,
} from "#/lib/export/gif/gifFrameChunk";

interface GifFrameEncoder {
  readonly maxInFlightFrames: number;
  // Worker encoding transfers the entire backing buffer of the pixel view.
  encodeFrame(input: GifFrameInput): Promise<FrameChunk>;
  dispose(): void;
}

export interface GifFrameWorkerEncodeRequest extends GifFrameInput {
  // Sent on the first frame assigned to this worker.
  job?: GifEncoderJob;
}

export type GifFrameWorkerEncodeResponse =
  | {
      type: "encoded-frame";
      chunk: FrameChunk;
    }
  | {
      type: "error";
      sequenceIndex: number;
      message: string;
    };

export function createBestGifFrameEncoder(job: GifEncoderJob): GifFrameEncoder {
  const sequential = job.ditherMode === "spatial-temporal";
  const workerCount = sequential ? 1 : defaultGifFrameWorkerCount();
  const framesPerWorker = sequential ? 1 : 2;
  const pool = createGifFrameWorkerEncoder(job, workerCount);
  if (pool) {
    return { ...pool, maxInFlightFrames: workerCount * framesPerWorker };
  }
  let chunks: ReturnType<typeof createGifFrameChunkEncoder> | undefined =
    createGifFrameChunkEncoder(job);
  return {
    maxInFlightFrames: framesPerWorker,
    async encodeFrame(frame) {
      if (!chunks) {
        throw new Error("GIF frame encoder was disposed.");
      }
      return chunks.encode(frame);
    },
    dispose() {
      chunks?.dispose();
      chunks = undefined;
    },
  };
}

function createGifFrameWorkerEncoder(
  job: GifEncoderJob,
  workerCount: number,
): Omit<GifFrameEncoder, "maxInFlightFrames"> | null {
  if (typeof Worker === "undefined") {
    return null;
  }

  const workers: Worker[] = [];

  try {
    for (let index = 0; index < workerCount; index += 1) {
      workers.push(createGifFrameWorker());
    }
  } catch {
    for (const worker of workers) {
      worker.terminate();
    }

    return null;
  }

  let disposed = false;
  const initializedWorkers = new WeakSet<Worker>();
  let globalPalette = job.globalPalette;
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
    const sequenceIndex =
      message.type === "error"
        ? message.sequenceIndex
        : message.chunk.sequenceIndex;
    const pendingRequest = pendingRequests.get(sequenceIndex);
    if (!pendingRequest) {
      return;
    }

    pendingRequests.delete(sequenceIndex);

    if (message.type === "error") {
      pendingRequest.reject(new Error(message.message));
      return;
    }

    globalPalette ??= message.chunk.globalPalette;
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
    encodeFrame(frame) {
      if (disposed) {
        return Promise.reject(new Error("GIF frame encoder was disposed."));
      }

      // Without a sampled palette the first worker establishes the global table.
      const workerIndex = globalPalette ? nextWorkerIndex : 0;
      const worker = workers[workerIndex];
      nextWorkerIndex = (workerIndex + 1) % workers.length;
      const { rgba } = frame;
      const buffer = rgba.buffer;
      if (!(buffer instanceof ArrayBuffer) || rgba.byteLength === 0) {
        return Promise.reject(
          new Error("GIF frame data must have an attached ArrayBuffer."),
        );
      }

      return new Promise<FrameChunk>((resolve, reject) => {
        pendingRequests.set(frame.sequenceIndex, { resolve, reject });
        try {
          worker.postMessage(
            {
              ...frame,
              ...(initializedWorkers.has(worker)
                ? {}
                : { job: { ...job, globalPalette } }),
            } satisfies GifFrameWorkerEncodeRequest,
            [buffer],
          );
          initializedWorkers.add(worker);
        } catch (error) {
          pendingRequests.delete(frame.sequenceIndex);
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
