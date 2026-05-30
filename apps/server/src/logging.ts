import { AsyncLocalStorage } from "node:async_hooks";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { NextFunction, Request, Response } from "express";
import {
  configure,
  fromAsyncSink,
  getConsoleSink,
  getJsonLinesFormatter,
  getLogfmtFormatter,
  getLogger,
  getTextFormatter,
  isLogLevel,
  withContext,
  type Logger,
  type Sink,
  type TextFormatter,
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
const DEFAULT_LOG_FILE_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_LOG_FILE_MAX_FILES = 5;
const LOG_FILE_SIZE_UNITS = new Map([
  ["b", 1],
  ["kb", 1024],
  ["kib", 1024],
  ["mb", 1024 * 1024],
  ["mib", 1024 * 1024],
  ["gb", 1024 * 1024 * 1024],
  ["gib", 1024 * 1024 * 1024],
]);

let loggingConfigured: Promise<void> | undefined;

type ServerLogFormat = "pretty" | "json" | "logfmt";

export interface ServerLogFileConfig {
  readonly filePath: string;
  readonly format: ServerLogFormat;
  readonly maxBytes: number;
  readonly maxFiles: number;
}

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

export function resolveServerLogFormat(value: string | undefined) {
  const format = value?.trim().toLowerCase();
  if (format === "json" || format === "logfmt" || format === "pretty") {
    return format;
  }

  return "pretty";
}

export function resolveLogFileMaxBytes(value: string | undefined) {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) {
    return DEFAULT_LOG_FILE_MAX_BYTES;
  }

  const match = /^(\d+)(?:\s*(b|kb|kib|mb|mib|gb|gib))?$/.exec(trimmed);
  if (!match) {
    return DEFAULT_LOG_FILE_MAX_BYTES;
  }

  const unit = match[2] ?? "b";
  const multiplier = LOG_FILE_SIZE_UNITS.get(unit);
  const size = Number(match[1]) * (multiplier ?? 1);
  if (!Number.isSafeInteger(size) || size <= 0) {
    return DEFAULT_LOG_FILE_MAX_BYTES;
  }

  return size;
}

export function resolveLogFileMaxFiles(value: string | undefined) {
  const maxFiles = Number(value?.trim());
  if (!Number.isSafeInteger(maxFiles) || maxFiles <= 0) {
    return DEFAULT_LOG_FILE_MAX_FILES;
  }

  return maxFiles;
}

export function resolveServerLogFileConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServerLogFileConfig | undefined {
  const configuredPath = env.CLIPARR_LOG_FILE?.trim();
  if (!configuredPath) {
    return undefined;
  }

  return {
    filePath: path.resolve(configuredPath),
    format: resolveServerLogFormat(
      env.CLIPARR_LOG_FILE_FORMAT ?? env.CLIPARR_LOG_FORMAT ?? "json",
    ),
    maxBytes: resolveLogFileMaxBytes(env.CLIPARR_LOG_FILE_MAX_SIZE),
    maxFiles: resolveLogFileMaxFiles(env.CLIPARR_LOG_FILE_MAX_FILES),
  };
}

function serverTextFormatter(format: ServerLogFormat): TextFormatter {
  if (format === "json") {
    return getJsonLinesFormatter({ properties: "flatten" });
  }

  if (format === "logfmt") {
    return getLogfmtFormatter();
  }

  return getTextFormatter({ timestamp: "date-time-tz" });
}

function serverConsoleSink(format: ServerLogFormat) {
  if (format === "pretty") {
    return getConsoleSink();
  }

  return getConsoleSink({ formatter: serverTextFormatter(format) });
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function rotatedLogFilePath(filePath: string, index: number) {
  return `${filePath}.${index}`;
}

function rotatingFileSink(config: ServerLogFileConfig) {
  const directory = path.dirname(config.filePath);
  const formatter = serverTextFormatter(config.format);
  let currentSize: number | undefined;
  let directoryReady: Promise<void> | undefined;

  async function ensureDirectory() {
    directoryReady ??= fs
      .mkdir(directory, { recursive: true })
      .then(() => undefined);
    await directoryReady;
  }

  async function logFileSize() {
    if (currentSize !== undefined) {
      return currentSize;
    }

    try {
      currentSize = (await fs.stat(config.filePath)).size;
    } catch {
      currentSize = 0;
    }

    return currentSize;
  }

  async function rotateLogFiles() {
    await ensureDirectory();

    if (config.maxFiles <= 1) {
      await fs.writeFile(config.filePath, "");
      currentSize = 0;
      return;
    }

    const oldestLog = rotatedLogFilePath(config.filePath, config.maxFiles - 1);
    if (await pathExists(oldestLog)) {
      await fs.unlink(oldestLog);
    }

    for (let index = config.maxFiles - 2; index >= 1; index -= 1) {
      const source = rotatedLogFilePath(config.filePath, index);
      if (await pathExists(source)) {
        await fs.rename(source, rotatedLogFilePath(config.filePath, index + 1));
      }
    }

    if (await pathExists(config.filePath)) {
      await fs.rename(config.filePath, rotatedLogFilePath(config.filePath, 1));
    }

    currentSize = 0;
  }

  return fromAsyncSink(async (record) => {
    const line = formatter(record);
    const byteLength = Buffer.byteLength(line);

    await ensureDirectory();
    if (
      (await logFileSize()) > 0 &&
      currentSize! + byteLength > config.maxBytes
    ) {
      await rotateLogFiles();
    }

    await fs.appendFile(config.filePath, line);
    currentSize = (currentSize ?? 0) + byteLength;
  });
}

function serverLogSinks(env: NodeJS.ProcessEnv = process.env) {
  const sinks: Record<string, Sink> = {
    console: serverConsoleSink(resolveServerLogFormat(env.CLIPARR_LOG_FORMAT)),
  };
  const sinkNames = ["console"];
  const fileConfig = resolveServerLogFileConfig(env);

  if (fileConfig) {
    sinks.file = rotatingFileSink(fileConfig);
    sinkNames.push("file");
  }

  return { sinks, sinkNames };
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
  const { sinks, sinkNames } = serverLogSinks();

  loggingConfigured = configure({
    sinks,
    loggers: [
      {
        category: [...SERVER_LOG_CATEGORY_PREFIX],
        sinks: sinkNames,
        lowestLevel,
      },
      {
        category: [...LOGTAPE_META_CATEGORY],
        sinks: sinkNames,
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
