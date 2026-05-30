export type LogFields = Record<string, unknown>;

export function compactLogFields(fields: LogFields): LogFields {
  return Object.fromEntries(
    Object.entries(fields).filter((entry) => entry[1] !== undefined),
  );
}

export function logEventFields(name: string, outcome?: string): LogFields {
  return compactLogFields({
    "event.name": name,
    "event.outcome": outcome,
  });
}

export function logDurationFields(
  startedAtMs: number,
  nowMs = Date.now(),
  fieldName = "event.duration.ms",
): LogFields {
  return {
    [fieldName]: Math.max(0, nowMs - startedAtMs),
  };
}

export function logErrorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: unknown };
    return compactLogFields({
      "error.name": error.name,
      "error.message": error.message,
      "error.code":
        typeof errorWithCode.code === "string" ? errorWithCode.code : undefined,
    });
  }

  return {
    "error.value": String(error),
  };
}

export function sanitizeUrlForLog(value: string | undefined) {
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
