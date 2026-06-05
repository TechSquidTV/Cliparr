import { parseSubtitleText } from "@/lib/subtitles/parseSubtitleText";
import type { SubtitleCue } from "@/lib/subtitles/types";

interface SubtitleParseWorkerResponseSuccess {
  ok: true;
  cues: SubtitleCue[];
}

interface SubtitleParseWorkerResponseFailure {
  ok: false;
  message: string;
}

type SubtitleParseWorkerResponse =
  | SubtitleParseWorkerResponseSuccess
  | SubtitleParseWorkerResponseFailure;

export interface SubtitleParseWorker {
  addEventListener(type: "message" | "error", listener: EventListener): void;
  removeEventListener(type: "message" | "error", listener: EventListener): void;
  postMessage(message: unknown): void;
  terminate(): void;
}

export type CreateSubtitleParseWorker = () => SubtitleParseWorker;

function createSubtitleParseWorker(): SubtitleParseWorker {
  return new Worker(new URL("parseSubtitleText.worker.ts", import.meta.url), {
    name: "cliparr-subtitle-parser",
    type: "module",
  });
}

function createAbortError() {
  const error = new Error("Subtitle parsing aborted.");
  error.name = "AbortError";
  return error;
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

export async function parseSubtitleTextAsync(
  text: string,
  format?: string,
  signal?: AbortSignal,
  createWorker: CreateSubtitleParseWorker = createSubtitleParseWorker,
): Promise<SubtitleCue[]> {
  if (signal?.aborted) {
    throw createAbortError();
  }

  let worker: SubtitleParseWorker;
  try {
    worker = createWorker();
  } catch {
    return parseSubtitleText(text, format);
  }

  return await new Promise<SubtitleCue[]>((resolve, reject) => {
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      signal?.removeEventListener("abort", handleAbort);
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleWorkerError);
      worker.terminate();
      callback();
    };

    const parseOnMainThread = () => {
      finish(() => {
        try {
          resolve(parseSubtitleText(text, format));
        } catch (error) {
          reject(toError(error));
        }
      });
    };

    const handleAbort = () => {
      finish(() => reject(createAbortError()));
    };

    const handleMessage = (event: Event) => {
      const message = (event as MessageEvent<SubtitleParseWorkerResponse>).data;
      if (!message) {
        parseOnMainThread();
        return;
      }

      if (message.ok) {
        finish(() => resolve(message.cues));
        return;
      }

      parseOnMainThread();
    };

    const handleWorkerError = () => {
      parseOnMainThread();
    };

    signal?.addEventListener("abort", handleAbort, { once: true });
    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleWorkerError);

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    try {
      worker.postMessage({ format, text });
    } catch {
      parseOnMainThread();
    }
  });
}
