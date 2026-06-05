import {
  configure,
  getConsoleSink,
  getJsonLinesFormatter,
  getLogger,
  isLogLevel,
  type Logger,
} from "@logtape/logtape";

const FRONTEND_LOG_CATEGORY_PREFIX = ["cliparr", "frontend"] as const;
// LogTape reserves this category for its own configuration and sink diagnostics.
const LOGTAPE_META_CATEGORY = ["logtape", "meta"] as const;

let loggingConfigured: Promise<void> | undefined;

type FrontendLogFormat = "pretty" | "json";

export interface ViteLoggingEnv {
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

export function resolveFrontendConsoleLogFormat(
  viteEnvironment: ViteLoggingEnv,
): FrontendLogFormat {
  return viteEnvironment.PROD ? "pretty" : "json";
}

function frontendConsoleSink(viteEnvironment: ViteLoggingEnv) {
  if (resolveFrontendConsoleLogFormat(viteEnvironment) === "json") {
    return getConsoleSink({
      formatter: getJsonLinesFormatter({ properties: "flatten" }),
    });
  }

  return getConsoleSink();
}

export function configureFrontendLogging() {
  if (loggingConfigured) {
    return loggingConfigured;
  }

  const viteEnvironment = import.meta.env as unknown as ViteLoggingEnv;
  const configuredLevel = viteEnvironment.VITE_CLIPARR_LOG_LEVEL?.trim();
  const defaultLowestLevel = viteEnvironment.PROD ? "info" : "debug";
  const lowestLevel =
    configuredLevel && isLogLevel(configuredLevel)
      ? configuredLevel
      : defaultLowestLevel;

  loggingConfigured = configure({
    sinks: {
      console: frontendConsoleSink(viteEnvironment),
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
