import type { NextFunction, Request, Response } from "express";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: {
      code: "not_found",
      message: `No route for ${req.method} ${req.path}`,
    },
  });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const apiError =
    err instanceof ApiError
      ? err
      : new ApiError(500, "internal_error", "Something went wrong");

  if (!(err instanceof ApiError)) {
    console.error(err);
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
