import type { Palette } from "@techsquidtv/gifenc";
import {
  createGifTemporalDitherResolver,
  type GifDitherMode,
  type GifPaletteFormat,
  type GifTemporalDitherSettings,
} from "#/lib/gifEncodingSettings";
import {
  encodeGifFrameChunk,
  type EncodeGifFrameChunkHelpers,
  type GifFrameChunk,
} from "#/lib/gifFrameChunk";

interface GifFrameEncodeInput {
  sequenceIndex: number;
  imageData: ImageData;
  width: number;
  height: number;
  maxColors: number;
  delayMs: number;
  palette?: Palette | null;
  paletteFormat: GifPaletteFormat;
  ditherMode: GifDitherMode;
  ditherStrength?: number;
  serpentine?: boolean;
  temporalDither?: GifTemporalDitherSettings | null;
}

export interface GifFrameEncoder {
  concurrency: number;
  encodeFrame(input: GifFrameEncodeInput): Promise<GifFrameChunk>;
  dispose(): void;
}

export interface GifFrameEncoderOptions {
  requiresSequentialFrames?: boolean;
}

export interface GifFrameWorkerEncodeRequest {
  type: "encode-frame";
  id: number;
  sequenceIndex: number;
  rgba: ArrayBuffer;
  width: number;
  height: number;
  maxColors: number;
  delayMs: number;
  palette?: Palette | null;
  paletteFormat: GifPaletteFormat;
  ditherMode: GifDitherMode;
  ditherStrength?: number;
  serpentine?: boolean;
  temporalDither?: GifTemporalDitherSettings | null;
}

export type GifFrameWorkerEncodeResponse =
  | {
      type: "encoded-frame";
      id: number;
      sequenceIndex: number;
      bytes: ArrayBuffer;
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

export function createInlineGifFrameEncoder(
  helpers: EncodeGifFrameChunkHelpers = {},
): GifFrameEncoder {
  const temporalDitherResolver = createGifTemporalDitherResolver();

  return {
    concurrency: 1,
    async encodeFrame(input) {
      return encodeGifFrameChunk(
        {
          sequenceIndex: input.sequenceIndex,
          rgba: input.imageData.data,
          width: input.width,
          height: input.height,
          maxColors: input.maxColors,
          delayMs: input.delayMs,
          palette: input.palette,
          paletteFormat: input.paletteFormat,
          ditherMode: input.ditherMode,
          ditherStrength: input.ditherStrength,
          serpentine: input.serpentine,
          temporalDither: temporalDitherResolver.resolve({
            ditherMode: input.ditherMode,
            height: input.height,
            paletteFormat: input.paletteFormat,
            temporalDither: input.temporalDither,
            width: input.width,
          }),
        },
        helpers,
      );
    },
    dispose() {
      // Inline encoding owns no long-lived resources.
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
      resolve: (chunk: GifFrameChunk) => void;
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

    pendingRequest.resolve({
      sequenceIndex: message.sequenceIndex,
      bytes: new Uint8Array(message.bytes),
    });
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
    encodeFrame(input) {
      if (disposed) {
        return Promise.reject(new Error("GIF frame encoder was disposed."));
      }

      const worker = workers[nextWorkerIndex];
      nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;
      const id = nextRequestId;
      nextRequestId += 1;
      const rgba = copyImageDataBuffer(input.imageData.data);

      return new Promise<GifFrameChunk>((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject });
        try {
          worker.postMessage(
            {
              type: "encode-frame",
              id,
              sequenceIndex: input.sequenceIndex,
              rgba,
              width: input.width,
              height: input.height,
              maxColors: input.maxColors,
              delayMs: input.delayMs,
              palette: input.palette,
              paletteFormat: input.paletteFormat,
              ditherMode: input.ditherMode,
              ditherStrength: input.ditherStrength,
              serpentine: input.serpentine,
              temporalDither: input.temporalDither,
            } satisfies GifFrameWorkerEncodeRequest,
            [rgba],
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

export function copyImageDataBuffer(data: Uint8ClampedArray) {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8ClampedArray(buffer).set(data);

  return buffer;
}
