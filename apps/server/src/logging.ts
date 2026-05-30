import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import {
  configure,
  getConsoleSink,
  getLogger,
  isLogLevel,
  withContext,
  type Logger,
} from "@logtape/logtape";
import {
  compactLogFields,
  logDurationFields,
  logEventFields,
} from "@cliparr/shared/logging";

const SERVER_LOG_CATEGORY_PREFIX = ["cliparr", "server"] as const;
// LogTape reserves this category for its own configuration and sink diagnostics.
const LOGTAPE_META_CATEGORY = ["logtape", "meta"] as const;
const SLOW_REQUEST_WARNING_MS = 10_000;

let loggingConfigured: Promise<void> | undefined;

export function getServerLogger(category: string | readonly string[]) {
  const parts = typeof category === "string" ? [category] : [...category];
  return getLogger([...SERVER_LOG_CATEGORY_PREFIX, ...parts]);
}

export function warnWithError(
  logger: Logger,
  error: unknown,
  message: string,
  properties: Record<string, unknown>,
) {
  if (error instanceof Error) {
    logger.warn(error, properties);
    return;
  }

  logger.warn(message, properties);
}

export function errorWithError(
  logger: Logger,
  error: unknown,
  message: string,
  properties: Record<string, unknown>,
) {
  if (error instanceof Error) {
    logger.error(error, properties);
    return;
  }

  logger.error(message, properties);
}

export function fatalWithError(
  logger: Logger,
  error: unknown,
  message: string,
  properties: Record<string, unknown>,
) {
  if (error instanceof Error) {
    logger.fatal(error, properties);
    return;
  }

  logger.fatal(message, properties);
}

export function configureLogging() {
  if (loggingConfigured) {
    return loggingConfigured;
  }

  const configuredLevel = process.env.CLIPARR_LOG_LEVEL?.trim();
  const lowestLevel =
    configuredLevel && isLogLevel(configuredLevel)
      ? configuredLevel
      : process.env.NODE_ENV === "production"
        ? "info"
        : "debug";

  loggingConfigured = configure({
    sinks: {
      console: getConsoleSink(),
    },
    loggers: [
      {
        category: [...SERVER_LOG_CATEGORY_PREFIX],
        sinks: ["console"],
        lowestLevel,
      },
      {
        category: [...LOGTAPE_META_CATEGORY],
        sinks: ["console"],
        lowestLevel: "warning",
      },
    ],
    contextLocalStorage: new AsyncLocalStorage<Record<string, unknown>>(),
  });

  return loggingConfigured;
}

const requestLogger = getServerLogger(["http", "request"]);

function requestRoute(req: Request) {
  const route = (req as unknown as { route?: { path?: unknown } }).route;
  const routePath = typeof route?.path === "string" ? route.path : undefined;
  if (!routePath) {
    return undefined;
  }

  return `${req.baseUrl}${routePath}`;
}

export function requestLoggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const requestId = randomUUID();
  const startedAt = Date.now();

  withContext(
    {
      "request.id": requestId,
      "http.method": req.method,
      "http.path": req.path,
      "http.original_url": req.originalUrl,
    },
    () => {
      res.setHeader("X-Request-Id", requestId);
      res.once("finish", () => {
        const durationMs = Date.now() - startedAt;
        const fields = compactLogFields({
          ...logEventFields("http.request", "completed"),
          ...logDurationFields(startedAt, startedAt + durationMs),
          "http.route": requestRoute(req),
          "http.status_code": res.statusCode,
        });

        requestLogger.trace("Completed HTTP request.", fields);

        if (
          res.statusCode >= 500 ||
          (durationMs >= SLOW_REQUEST_WARNING_MS &&
            !req.path.startsWith("/api/media/"))
        ) {
          requestLogger.warn("HTTP request needs attention.", {
            ...fields,
            "event.outcome": res.statusCode >= 500 ? "server_error" : "slow",
            "http.slow_threshold.ms": SLOW_REQUEST_WARNING_MS,
          });
        }
      });

      next();
    },
  );
}
