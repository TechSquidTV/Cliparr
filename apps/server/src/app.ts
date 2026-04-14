import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { errorHandler, notFoundHandler } from "./http/errors.js";
import { mediaRouter } from "./routes/media.js";
import { providersRouter } from "./routes/providers.js";
import { sessionRouter } from "./routes/session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../../..");
const frontendRoot = path.join(workspaceRoot, "apps/frontend");

export async function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json());
  app.use((req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/providers", providersRouter);
  app.use("/api/session", sessionRouter);
  app.use("/api/media", mediaRouter);
  app.use("/api", notFoundHandler);

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: frontendRoot,
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(frontendRoot, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.use(errorHandler);

  return app;
}
