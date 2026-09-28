import { Router } from "express";
import { livePlayback } from "@/playback/livePlayback";
import { requireAccountSession } from "@/session/request";

export const livePlaybackRouter = Router();

livePlaybackRouter.get("/", (request, res) => {
  const session = requireAccountSession(request);
  const unsubscribe = livePlayback.subscribe(session, (event) => {
    if (res.destroyed || res.writableEnded) {
      return;
    }
    if (res.writableLength > 1024 * 1024) {
      res.destroy();
      return;
    }
    // Admission can throw HTTP 429; only start SSE after it succeeds.
    if (!res.headersSent) {
      res.status(200).set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
    }
    res.write(`event: playback\ndata: ${JSON.stringify(event)}\n\n`);
    if (event.type === "unauthorized") {
      res.end();
    }
  });
  const heartbeat = setInterval(() => {
    if (res.destroyed || res.writableEnded) {
      return;
    }
    if (res.writableLength > 1024 * 1024) {
      res.destroy();
    } else {
      res.write("event: heartbeat\ndata: {}\n\n");
    }
  }, 15_000);
  heartbeat.unref();
  res.once("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

livePlaybackRouter.post("/retry", (request, res) => {
  requireAccountSession(request);
  livePlayback.retry();
  res.sendStatus(204);
});
