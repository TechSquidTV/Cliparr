import { lookup } from "node:dns/promises";
import { addAbortListener } from "node:events";
import { errorMessage } from "@/providers/shared/utilities";

export async function lookupWithSignal(hostname: string, signal: AbortSignal) {
  signal.throwIfAborted();
  let subscription: ReturnType<typeof addAbortListener> | undefined;
  try {
    const cancellation = new Promise<never>((_resolve, reject) => {
      subscription = addAbortListener(signal, () => {
        const reason: unknown = signal.reason;
        reject(
          reason instanceof Error ? reason : new Error(errorMessage(reason)),
        );
      });
    });
    // lookup() cannot cancel its OS work; stop waiting when the request aborts.
    return await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      cancellation,
    ]);
  } finally {
    subscription?.[Symbol.dispose]();
  }
}
