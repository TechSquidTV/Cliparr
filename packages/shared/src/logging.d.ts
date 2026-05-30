export type LogFields = Record<string, unknown>;

export declare function compactLogFields(fields: LogFields): LogFields;

export declare function logEventFields(
  name: string,
  outcome?: string,
): LogFields;

export declare function logDurationFields(
  startedAtMs: number,
  nowMs?: number,
  fieldName?: string,
): LogFields;

export declare function logErrorFields(error: unknown): LogFields;

export declare function sanitizeUrlForLog(
  value: string | undefined,
): string | undefined;
