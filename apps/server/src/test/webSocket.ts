import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

/** Minimal server peer for tests, deliberately leaving close handshakes unanswered. */
export function acceptTestWebSocket(
  request: IncomingMessage,
  socket: Duplex,
  options: { compression?: boolean } = {},
) {
  const key = request.headers["sec-websocket-key"];
  assert.equal(typeof key, "string");
  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n${options.compression ? "Sec-WebSocket-Extensions: permessage-deflate\r\n" : ""}\r\n`,
  );
  socket.on("error", () => {});
  socket.on("data", () => {});
  socket.on("end", () => socket.destroy());
  return (text: string | Uint8Array, frameByte = 0x81) => {
    const payload = Buffer.from(text);
    assert.ok(payload.length <= 65_535, "Test frame exceeds supported size");
    const header = Buffer.alloc(payload.length < 126 ? 2 : 4);
    header[0] = frameByte;
    header[1] = Math.min(payload.length, 126);
    if (payload.length >= 126) {
      header.writeUInt16BE(payload.length, 2);
    }
    socket.write(Buffer.concat([header, payload]));
  };
}
