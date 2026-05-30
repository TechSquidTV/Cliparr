import {
  configure,
  getConsoleSink,
  getLogger,
  isLogLevel,
  type Logger,
} from "@logtape/logtape";

const FRONTEND_LOG_CATEGORY_PREFIX = ["cliparr", "frontend"] as const;
// LogTape reserves this category for its own configuration and sink diagnostics.
const LOGTAPE_META_CATEGORY = ["logtape", "meta"] as const;

let loggingConfigured: Promise<void> | undefined;

interface ViteLoggingEnv {
  readonly VITE_CLIPARR_LOG_LEVEL?: string;
  readonly PROD: boolean;
}

export function getFrontendLogger(category: string | readonly string[]) {
  const parts = typeof category === "string" ? [category] : [...category];
  return getLogger([...FRONTEND_LOG_CATEGORY_PREFIX, ...parts]);
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

export function configureFrontendLogging() {
  if (loggingConfigured) {
    return loggingConfigured;
  }

  const viteEnv = import.meta.env as unknown as ViteLoggingEnv;
  const configuredLevel = viteEnv.VITE_CLIPARR_LOG_LEVEL?.trim();
  const lowestLevel =
    configuredLevel && isLogLevel(configuredLevel)
      ? configuredLevel
      : viteEnv.PROD
        ? "info"
        : "debug";

  loggingConfigured = configure({
    sinks: {
      console: getConsoleSink(),
    },
    loggers: [
      {
        category: [...FRONTEND_LOG_CATEGORY_PREFIX],
        sinks: ["console"],
        lowestLevel,
      },
      {
        category: [...LOGTAPE_META_CATEGORY],
        sinks: ["console"],
        lowestLevel: "warning",
      },
    ],
  });

  return loggingConfigured;
}
