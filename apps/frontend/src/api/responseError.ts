interface ResponseErrorDetails {
  code?: string;
  message?: string;
}

function responseErrorDetails(payload: unknown): ResponseErrorDetails {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const error = "error" in payload ? payload.error : undefined;
  if (!error || typeof error !== "object") {
    return {};
  }

  return {
    code:
      "code" in error && typeof error.code === "string"
        ? error.code
        : undefined,
    message:
      "message" in error && typeof error.message === "string"
        ? error.message
        : undefined,
  };
}

export async function readResponseErrorDetails(
  response: Response,
): Promise<ResponseErrorDetails> {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return {};
  }

  const text = await response.text();
  try {
    return responseErrorDetails(JSON.parse(text));
  } catch {
    return {};
  }
}
