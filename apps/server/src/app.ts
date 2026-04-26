import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { CLIPARR_VERSION } from "./config/version.js";
import { checkDatabaseHealth, initializeDatabase } from "./db/database.js";
import { errorHandler, notFoundHandler } from "./http/errors.js";
import { requestOriginIsPotentiallyTrustworthy } from "./http/requestOrigin.js";
import { mediaRouter } from "./routes/media.js";
import { providersRouter } from "./routes/providers.js";
import { sessionRouter } from "./routes/session.js";
import { sourcesRouter } from "./routes/sources.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../../..");
const frontendRoot = path.join(workspaceRoot, "apps/frontend");
const DEFAULT_DEV_FRONTEND_URL = "http://localhost:5173";

export async function createApp() {
  initializeDatabase();

  const app = express();

  // Respect reverse-proxy protocol headers so auth callbacks and cookie policies
  // follow the public request origin instead of the internal container hop.
  app.set("trust proxy", true);
  app.disable("x-powered-by");
  app.use(express.json());
  app.use((req, res, next) => {
    if (requestOriginIsPotentiallyTrustworthy(req)) {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    }

    next();
  });

  app.get("/api/health", (_req, res) => {
    checkDatabaseHealth();
    res.json({ status: "ok", database: "ok", version: CLIPARR_VERSION });
  });

  app.use("/api/providers", providersRouter);
  app.use("/api/session", sessionRouter);
  app.use("/api/sources", sourcesRouter);
  app.use("/api/media", mediaRouter);
  app.use("/api", notFoundHandler);

  if (process.env.NODE_ENV !== "production") {
    const frontendUrl = new URL(process.env.CLIPARR_FRONTEND_URL ?? DEFAULT_DEV_FRONTEND_URL);
    app.get(/^(?!\/api(?:\/|$)).*/, (req, res) => {
      const redirectUrl = new URL(frontendUrl);
      const safePath = req.path.replace(/^\/+/, "/");
      const queryIndex = req.originalUrl.indexOf("?");

      redirectUrl.pathname = safePath;
      redirectUrl.search = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";

      res.redirect(307, redirectUrl.toString());
    });
  } else {
    const distPath = path.join(frontendRoot, "dist");
    app.use(express.static(distPath));
    app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.use(errorHandler);

  return { app };
}
