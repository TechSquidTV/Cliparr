/** Decode SSE incrementally, including split UTF-8, CRLF, comments and multiline data. */
export async function readServerEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: string) => void,
  onActivity?: () => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "message";
  let data: string[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      onActivity?.();
      buffer += decoder.decode(chunk.value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
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
        if (size > 4 * 1024 * 1024) {
          throw new Error("Event exceeds size limit");
        }
      }
      if (buffer.length > 4 * 1024 * 1024) {
        throw new Error("Event exceeds size limit");
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
