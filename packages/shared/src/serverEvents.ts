/** Decode SSE incrementally, including split UTF-8, CRLF, comments and multiline data. */
export async function readServerEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: string) => void,
  onActivity?: () => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fragments: string[] = [];
  let pendingLength = 0;
  let event = "message";
  let data: string[] = [];
  let size = 0;
  const sizeLimit = 4 * 1024 * 1024;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      onActivity?.();
      const text = decoder.decode(chunk.value, { stream: true });
      let start = 0;
      let newline: number;
      // Scan each decoded chunk once. Join a fragmented line only when it is
      // complete, so even a long line arriving byte by byte stays linear.
      while ((newline = text.indexOf("\n", start)) >= 0) {
        const fragment = text.slice(start, newline);
        if (pendingLength + fragment.length > sizeLimit) {
          throw new Error("Event exceeds size limit");
        }
        const line = (
          fragments.length > 0 ? [...fragments, fragment].join("") : fragment
        ).replace(/\r$/, "");
        fragments = [];
        pendingLength = 0;
        start = newline + 1;
        if (!line) {
          if (data.length > 0) {
            onEvent(event, data.join("\n"));
          }
          event = "message";
          data = [];
          size = 0;
        } else if (line.startsWith("data:")) {
          const value = line.slice(5).replace(/^ /, "");
          data.push(value);
          size += line.length + 1;
        } else if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        }
        if (size > sizeLimit) {
          throw new Error("Event exceeds size limit");
        }
      }
      if (start < text.length) {
        const fragment = text.slice(start);
        fragments.push(fragment);
        pendingLength += fragment.length;
      }
      if (pendingLength > sizeLimit) {
        throw new Error("Event exceeds size limit");
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
