// The placeholder scheme preserves historical protocol-relative log output.
const SANITIZE_URL_BASE = "http://cliparr.local";

function tryParseAbsoluteUrl(value) {
  try {
    return new URL(value);
  } catch {
    return;
  }
}

function tryParseUrlWithBase(value, base) {
  try {
    return new URL(value, base);
  } catch {
    return;
  }
}

export function compactLogFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).filter((entry) => entry[1] !== undefined),
  );
}

export function logEventFields(name, outcome) {
  return compactLogFields({
    "event.name": name,
    "event.outcome": outcome,
  });
}

export function logDurationFields(
  startedAtMs,
  nowMs = Date.now(),
  fieldName = "event.duration.ms",
) {
  return {
    [fieldName]: Math.max(0, nowMs - startedAtMs),
  };
}

export function logErrorFields(error) {
  if (error instanceof Error) {
    return compactLogFields({
      "error.name": error.name,
      "error.message": error.message,
      "error.code": typeof error.code === "string" ? error.code : undefined,
    });
  }

  return {
    "error.value": String(error),
  };
}

export function sanitizeUrlForLog(value) {
  if (!value) {
    return value;
  }

  const absoluteUrl = tryParseAbsoluteUrl(value);
  if (absoluteUrl) {
    return `${absoluteUrl.origin}${absoluteUrl.pathname}`;
  }

  const parsed = tryParseUrlWithBase(value, SANITIZE_URL_BASE);
  if (parsed) {
    return parsed.origin === SANITIZE_URL_BASE
      ? parsed.pathname
      : `${parsed.origin}${parsed.pathname}`;
  }

  return value.split(/[#?]/, 1)[0] ?? value;
}
