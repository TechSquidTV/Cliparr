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

  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    // Relative URLs are logged without query strings or fragments.
  }

  try {
    const parsed = new URL(value, "http://cliparr.local");
    return parsed.origin === "http://cliparr.local"
      ? parsed.pathname
      : `${parsed.origin}${parsed.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0] ?? value;
  }
}
