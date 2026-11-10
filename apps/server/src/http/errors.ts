import { logEventFields } from "@cliparr/shared/logging";
import type { NextFunction, Request, Response } from "express";

import { getServerLogger, logServerError } from "@/logging";

const logger = getServerLogger(["http", "error"]);

export interface ApiError extends Error {
  status: number;
  code: string;
}

export function createApiError(
  status: number,
  code: string,
  message: string,
): ApiError {
  return Object.assign(new Error(message), {
    name: "ApiError",
    status,
    code,
  });
}

export function throwNotAuthenticated(): never {
  throw createApiError(
    401,
    "not_authenticated",
    "Sign in with a provider first",
  );
}

export function isApiError(error: unknown): error is ApiError {
  const candidate = error as Partial<ApiError>;

  return (
    error instanceof Error &&
    candidate.name === "ApiError" &&
    typeof candidate.status === "number" &&
    typeof candidate.code === "string"
  );
}

export function asyncHandler(
  handler: (
    request: Request,
    res: Response,
    next: NextFunction,
  ) => Promise<unknown>,
) {
  return (request: Request, res: Response, next: NextFunction) => {
    void handler(request, res, next).catch(next);
  };
}

export function notFoundHandler(request: Request, res: Response) {
  res.status(404).json({
    error: {
      code: "not_found",
      message: `No route for ${request.method} ${request.path}`,
    },
  });
}

export function errorHandler(
  error: unknown,
  request: Request,
  res: Response,
  _next: NextFunction,
) {
  let apiError: ApiError;
  if (
    error instanceof Error &&
    "type" in error &&
    error.type === "entity.parse.failed"
  ) {
    // Express attaches the submitted body, and the message can quote its contents.
    apiError = createApiError(
      400,
      "invalid_json",
      "Request body must be a valid JSON object or array.",
    );
    logger.warn(apiError.message, {
      ...logEventFields("http.request", "invalid_json"),
      "http.method": request.method,
      "http.status_code": apiError.status,
      "error.type": error.type,
    });
  } else if (isApiError(error)) {
    apiError = error;
    if (apiError.status >= 500) {
      logger.error(apiError, {
        ...logEventFields("http.request", "api_error"),
        "http.status_code": apiError.status,
        "error.code": apiError.code,
        "error.message": apiError.message,
        "http.method": request.method,
      });
    }
  } else {
    apiError = createApiError(500, "internal_error", "Something went wrong");
    logServerError(logger, "error", error, "Unhandled request error.", {
      ...logEventFields("http.request", "unhandled_error"),
      "http.method": request.method,
    });
  }

  if (res.headersSent) {
    return;
  }

  res.status(apiError.status).json({
    error: {
      code: apiError.code,
      message: apiError.message,
    },
  });
}
