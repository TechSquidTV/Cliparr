import type { NextFunction, Request, Response } from "express";
import { logErrorFields, logEventFields } from "@cliparr/shared/logging";
import { errorWithError, getServerLogger } from "@/logging";

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
  const apiError = isApiError(error)
    ? error
    : createApiError(500, "internal_error", "Something went wrong");

  if (!isApiError(error)) {
    errorWithError(logger, error, "Unhandled request error.", {
      ...logEventFields("http.request", "unhandled_error"),
      ...logErrorFields(error),
      "http.method": request.method,
      "http.original_url": request.originalUrl,
    });
  } else if (apiError.status >= 500) {
    logger.error(apiError, {
      ...logEventFields("http.request", "api_error"),
      "http.status_code": apiError.status,
      "error.code": apiError.code,
      "error.message": apiError.message,
      "http.method": request.method,
      "http.original_url": request.originalUrl,
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
