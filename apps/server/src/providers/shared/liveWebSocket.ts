import { createApiError } from "@/http/errors";
import { WebSocket } from "undici";
import { isIP, type Socket } from "node:net";
import { createPinnedDnsAgent } from "@/providers/shared/pinnedFetch";

export async function readLiveWebSocket(options: {
  url: URL;
  addresses: readonly string[];
  headers: Headers;
  signal: AbortSignal;
  receiveTimeoutMs?: number;
  onOpen: (send: (message: string) => void) => void;
  onMessage: (message: string, send: (message: string) => void) => void;
}) {
  options.signal.throwIfAborted();
  const hostname = options.url.hostname.replaceAll(/^\[|\]$/g, "");
  const transports = new Set<Socket>();
  const dispatcher = createPinnedDnsAgent(
    isIP(hostname) ? [hostname] : options.addresses,
    {
      // Bound buffering and decompression before a complete message is emitted.
      webSocket: { maxPayloadSize: 4 * 1024 * 1024, maxFragments: 1024 },
      onSocket(transport) {
        transports.add(transport);
        transport.once("close", () => transports.delete(transport));
      },
    },
  );
  const socket = new WebSocket(options.url, {
    dispatcher,
    headers: Object.fromEntries(options.headers.entries()),
  });
  const send = (message: string) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(message);
    }
  };
  try {
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      let receiveTimeout: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error) => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(receiveTimeout);
        clearTimeout(timeout);
        options.signal.removeEventListener("abort", abort);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const activity = () => {
        clearTimeout(receiveTimeout);
        receiveTimeout = setTimeout(
          () =>
            finish(
              createApiError(
                504,
                "live_connection_stalled",
                "Live connection stopped responding",
              ),
            ),
          options.receiveTimeoutMs ?? 75_000,
        );
      };
      const abort = () => {
        finish();
      };
      const timeout = setTimeout(
        () =>
          finish(
            createApiError(
              504,
              "live_connection_timeout",
              "Live connection timed out",
            ),
          ),
        10_000,
      );
      options.signal.addEventListener("abort", abort, { once: true });
      socket.addEventListener("open", () => {
        if (finished || options.signal.aborted) {
          return;
        }
        clearTimeout(timeout);
        activity();
        try {
          options.onOpen(send);
        } catch (error) {
          finish(new Error("Live subscription failed", { cause: error }));
        }
      });
      socket.addEventListener("message", (event) => {
        if (finished || options.signal.aborted) {
          return;
        }
        activity();
        try {
          if (typeof event.data !== "string") {
            throw new TypeError("Invalid live message");
          }
          options.onMessage(event.data, send);
        } catch (error) {
          finish(new Error("Invalid live session update", { cause: error }));
        }
      });
      socket.addEventListener("error", (event) =>
        finish(new Error("Live connection failed", { cause: event.error })),
      );
      socket.addEventListener("close", () =>
        finish(new Error("Live connection closed")),
      );
    });
  } finally {
    socket.close();
    // Upgraded sockets no longer belong to the dispatcher. Bound the close
    // handshake so an unresponsive peer cannot retain a TCP connection.
    if (transports.size > 0) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          for (const transport of transports) {
            transport.destroy();
          }
          resolve();
        }, 250);
        for (const transport of transports) {
          transport.once("close", () => {
            if (transports.size === 0) {
              clearTimeout(timeout);
              resolve();
            }
          });
        }
      });
    }
    await dispatcher.destroy();
  }
}
