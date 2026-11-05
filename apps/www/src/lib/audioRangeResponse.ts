/** Add single-byte-range support to audio served by the static assets binding. */
export function audioRangeResponse(
  request: Request,
  response: Response,
): Response {
  const length = Number(response.headers.get("Content-Length"));
  if (
    response.status !== 200 ||
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    response.headers.has("Content-Encoding")
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Accept-Ranges", "bytes");
  const range = request.headers.get("Range");
  const ifRange = request.headers.get("If-Range");
  const matchesValidator =
    !ifRange ||
    (!ifRange.startsWith("W/") &&
      (ifRange === response.headers.get("ETag") ||
        ifRange === response.headers.get("Last-Modified")));
  const match = range?.match(/^bytes=(\d*)-(\d*)$/u);
  // Ignore unsupported/malformed ranges, HEAD ranges, and stale validators.
  if (
    request.method !== "GET" ||
    !response.body ||
    !matchesValidator ||
    !match ||
    (!match[1] && !match[2])
  ) {
    return new Response(response.body, { status: response.status, headers });
  }

  const start = match[1]
    ? Number(match[1])
    : Math.max(0, length - Number(match[2]));
  const end =
    match[1] && match[2] ? Math.min(length - 1, Number(match[2])) : length - 1;
  if (start >= length || end < start) {
    void response.body.cancel();
    headers.set("Content-Range", `bytes */${length}`);
    headers.set("Content-Length", "0");
    return new Response(null, { status: 416, headers });
  }

  headers.set("Content-Range", `bytes ${start}-${end}/${length}`);
  headers.set("Content-Length", String(end - start + 1));
  const reader = response.body.getReader();
  let offset = 0;
  // Stream only the selected bytes without buffering the entire podcast per seek.
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (offset <= end) {
        const { done, value } = await reader.read();
        if (done) {
          controller.error(
            new Error("Audio asset ended before the requested range."),
          );
          return;
        }
        const from = Math.max(0, start - offset);
        const to = Math.min(value.byteLength, end + 1 - offset);
        offset += value.byteLength;
        if (from < to) {
          controller.enqueue(value.subarray(from, to));
          if (offset > end) {
            controller.close();
            await reader.cancel();
          }
          return;
        }
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: 206, headers });
}
