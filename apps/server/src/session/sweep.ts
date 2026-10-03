import { logErrorFields, logEventFields } from "@cliparr/shared/logging";
import { purgeExpiredRememberedProviderSessions } from "@/db/rememberedProviderSessionsRepository";
import { getServerLogger, warnWithError } from "@/logging";
import { purgeExpiredProviderSessions } from "@/session/store";

const SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const logger = getServerLogger(["session", "sweep"]);

export interface ExpiredSessionSweepResult {
  purgedProviderSessions: number;
  purgedRememberedSessions: number;
}

// Removes sessions that can never be used again: expired provider sessions
// (with their cached records and media handles) and expired or revoked
// remembered sessions. Expired sessions are already refused on access; the
// sweep keeps the tables and in-memory maps from growing unboundedly.
export function purgeExpiredSessions(
  now = Date.now(),
): ExpiredSessionSweepResult {
  const purgedProviderSessions = purgeExpiredProviderSessions(now);
  const purgedRememberedSessions = purgeExpiredRememberedProviderSessions(now);

  if (purgedProviderSessions > 0 || purgedRememberedSessions > 0) {
    logger.info("Purged expired sessions.", {
      ...logEventFields("session.sweep", "success"),
      "session.purged_count": purgedProviderSessions,
      "session.remembered.purged_count": purgedRememberedSessions,
    });
  }

  return { purgedProviderSessions, purgedRememberedSessions };
}

function runExpiredSessionSweep() {
  try {
    purgeExpiredSessions();
  } catch (error) {
    warnWithError(logger, error, "Expired session sweep failed.", {
      ...logEventFields("session.sweep", "failure"),
      ...logErrorFields(error),
    });
  }
}

// Runs the sweep immediately, then hourly. The timer is unref'd so it never
// keeps the process alive; the returned function stops it for shutdown.
export function startExpiredSessionSweep() {
  runExpiredSessionSweep();
  const interval = setInterval(
    runExpiredSessionSweep,
    SESSION_SWEEP_INTERVAL_MS,
  );
  interval.unref();

  return () => {
    clearInterval(interval);
  };
}
