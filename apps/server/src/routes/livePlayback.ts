import { Router } from "express";
import { livePlayback } from "@/playback/livePlayback";
import { requireAccountSession } from "@/session/request";

export const livePlaybackRouter = Router();

livePlaybackRouter.get("/", (request, res) => {
  const session = requireAccountSession(request);
  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  const heartbeat = setInterval(() => {
    if (res.writableLength > 1024 * 1024) {
      res.end();
    } else {
      res.write("event: heartbeat\ndata: {}\n\n");
    }
  }, 15_000);
  heartbeat.unref();
  res.once("close", () => {
    clearInterval(heartbeat);
  });
  const unsubscribe = livePlayback.subscribe(session, (event) => {
    if (res.destroyed || res.writableEnded) {
      return;
    }
    if (res.writableLength > 1024 * 1024) {
      res.end();
      return;
    }
    res.write(`event: playback\ndata: ${JSON.stringify(event)}\n\n`);
    if (event.type === "unauthorized") {
      res.end();
    }
  });
  res.once("close", unsubscribe);
});

livePlaybackRouter.post("/retry", (request, res) => {
  requireAccountSession(request);
  livePlayback.retry();
  res.sendStatus(204);
});
