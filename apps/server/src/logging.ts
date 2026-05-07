import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { configure, getConsoleSink, getLogger, isLogLevel, withContext } from "@logtape/logtape";

const LOG_CATEGORY_PREFIX = ["cliparr"];

let loggingConfigured: Promise<void> | undefined;

export function getServerLogger(category: string | readonly string[]) {
  const parts = typeof category === "string" ? [category] : [...category];
  return getLogger([...LOG_CATEGORY_PREFIX, ...parts]);
}

export function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
    };
  }

  return {
    errorValue: String(error),
  };
}

export function configureLogging() {
  if (loggingConfigured) {
    return loggingConfigured;
  }

  const configuredLevel = process.env.CLIPARR_LOG_LEVEL?.trim();
  const lowestLevel = configuredLevel && isLogLevel(configuredLevel)
    ? configuredLevel
    : (process.env.NODE_ENV === "production" ? "info" : "debug");

  loggingConfigured = configure({
    sinks: {
      console: getConsoleSink(),
    },
    loggers: [
      {
        category: "cliparr",
        sinks: ["console"],
        lowestLevel,
      },
      {
        category: "logtape",
        sinks: ["console"],
        lowestLevel: "warning",
      },
    ],
    contextLocalStorage: new AsyncLocalStorage<Record<string, unknown>>(),
  });

  return loggingConfigured;
}

const requestLogger = getServerLogger(["http", "request"]);

export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = randomUUID();
  const startedAt = Date.now();

  withContext({
    requestId,
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
  }, () => {
    res.setHeader("X-Request-Id", requestId);
    res.once("finish", () => {
      requestLogger.trace("Completed request {method} {originalUrl}.", {
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });

    next();
  });
}
