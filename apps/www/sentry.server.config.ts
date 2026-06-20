import * as Sentry from "@sentry/astro";

const sentryDsn = process.env.SENTRY_DSN?.trim();

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    integrations: [],
  });
}
