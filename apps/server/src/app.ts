import express from "express";
import path from "node:path";
import { CLIPARR_VERSION } from "@/config/version";
import { checkDatabaseHealth, initializeDatabase } from "@/db/database";
import { errorHandler, notFoundHandler } from "@/http/errors";
import { requestOriginIsPotentiallyTrustworthy } from "@/http/requestOrigin";
import { configureLogging, requestLoggingMiddleware } from "@/logging";
import { mediaRouter } from "@/routes/media";
import { providersRouter } from "@/routes/providers";
import { sessionRouter } from "@/routes/session";
import { sourcesRouter } from "@/routes/sources";
import { versionRouter } from "@/routes/version";

const appDirectory = import.meta.dirname;
const workspaceRoot = path.resolve(appDirectory, "../../..");
const frontendRoot = path.join(workspaceRoot, "apps/frontend");
const DEFAULT_DEV_FRONTEND_URL = "http://localhost:5173";
const TRUSTED_PROXY_SUBNETS = ["loopback", "linklocal", "uniquelocal"];
const IMMUTABLE_FRONTEND_ASSET_CACHE_CONTROL =
  "public, max-age=31536000, immutable";
const FRONTEND_DOCUMENT_CACHE_CONTROL = "no-cache";

export interface CreateAppOptions {
  frontendDistPath?: string;
}

function isHashedFrontendAsset(filePath: string) {
  const normalizedFilePath = filePath.replaceAll(path.sep, "/");
  return /(?:^|\/)assets\/.+-[\w-]{8,}\.[^/]+$/.test(normalizedFilePath);
}

function isFrontendDocument(filePath: string) {
  return path.extname(filePath).toLowerCase() === ".html";
}

export async function createApp(options: CreateAppOptions = {}) {
  await configureLogging();
  initializeDatabase();

  const app = express();

  app.set("trust proxy", TRUSTED_PROXY_SUBNETS);
  app.disable("x-powered-by");
  app.use(requestLoggingMiddleware);
  app.use(express.json());
  app.use((request, res, next) => {
    if (requestOriginIsPotentiallyTrustworthy(request)) {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    }

    next();
  });

  app.get("/api/health", (_request, res) => {
    checkDatabaseHealth();
    res.json({
      status: "ok",
      database: "ok",
      ...(CLIPARR_VERSION ? { version: CLIPARR_VERSION } : {}),
    });
  });

  app.use("/api/providers", providersRouter);
  app.use("/api/session", sessionRouter);
  app.use("/api/sources", sourcesRouter);
  app.use("/api/media", mediaRouter);
  app.use("/api/version", versionRouter);
  app.use("/api", notFoundHandler);

  if (process.env.NODE_ENV === "production") {
    const distributionPath =
      options.frontendDistPath ?? path.join(frontendRoot, "dist");
    app.use(
      express.static(distributionPath, {
        setHeaders(res, filePath) {
          if (isHashedFrontendAsset(filePath)) {
            res.setHeader(
              "Cache-Control",
              IMMUTABLE_FRONTEND_ASSET_CACHE_CONTROL,
            );
            return;
          }

          if (isFrontendDocument(filePath)) {
            res.setHeader("Cache-Control", FRONTEND_DOCUMENT_CACHE_CONTROL);
          }
        },
      }),
    );
    app.get(/^(?!\/api(?:\/|$)).*/, (_request, res) => {
      res.setHeader("Cache-Control", FRONTEND_DOCUMENT_CACHE_CONTROL);
      res.sendFile(path.join(distributionPath, "index.html"));
    });
  } else {
    const frontendUrl = new URL(
      process.env.CLIPARR_FRONTEND_URL ?? DEFAULT_DEV_FRONTEND_URL,
    );
    app.get(/^(?!\/api(?:\/|$)).*/, (request, res) => {
      const redirectUrl = new URL(frontendUrl);
      const safePath = request.path.replace(/^\/+/, "/");
      const queryIndex = request.originalUrl.indexOf("?");

      redirectUrl.pathname = safePath;
      redirectUrl.search =
        queryIndex === -1 ? "" : request.originalUrl.slice(queryIndex);

      res.redirect(307, redirectUrl.toString());
    });
  }

  app.use(errorHandler);

  return { app };
}
