import * as Sentry from "@sentry/astro";

interface RuntimeConfig {
  sentryDsn?: unknown;
}

void initializeSentry();

async function initializeSentry() {
  const dsn = await loadRuntimeSentryDsn();

  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    integrations: [],
  });
}

async function loadRuntimeSentryDsn() {
  try {
    const response = await fetch("/__cliparr/runtime-config.json", {
      cache: "no-store",
    });

    if (!response.ok) {
      return "";
    }

    const config = (await response.json()) as RuntimeConfig;

    return stringValue(config.sentryDsn);
  } catch {
    return "";
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
