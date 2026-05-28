import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import type { Response } from "express";
import { ApiError } from "../http/errors.js";
import type { ProviderSessionRecord } from "../session/store.js";
import type { MediaHandle } from "./types.js";
import {
  assertAllowedMediaHandleRequestUrl,
  fetchMediaHandleRequest,
  proxyProviderMediaResponse,
  proxyUpstreamMediaResponse,
  sanitizeLoggedMediaPath,
  shouldAttachProviderAuth,
  shouldForwardMediaRange,
} from "./shared/mediaProxy.js";

function createSession(): ProviderSessionRecord {
  return {
    id: "session-1",
    providerId: "plex",
    providerAccountId: "account-1",
    userToken: "user-token",
    mediaHandles: new Map(),
    createdAt: 0,
    expiresAt: Date.now() + 60_000,
  };
}

function createMediaHandle(overrides: Partial<MediaHandle> = {}): MediaHandle {
  return {
    id: "handle-1",
    providerId: "plex",
    sourceId: "source-1",
    baseUrl: "http://plex.local:32400",
    path: "/video/master.m3u8",
    token: "provider-token",
    lastAccessedAt: 0,
    ...overrides,
  };
}

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: new Map<string, string>(),
    body: "",
    ended: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string | number) {
      this.headers.set(name.toLowerCase(), String(value));
      return this;
    },
    send(body: string) {
      this.body = body;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

function createStreamingResponseRecorder() {
  const stream = new PassThrough();
  const headers = new Map<string, string>();
  let statusCode = 200;
  stream.resume();

  return Object.assign(stream, {
    get statusCode() {
      return statusCode;
    },
    set statusCode(value: number) {
      statusCode = value;
    },
    headers,
    status(code: number) {
      statusCode = code;
      return this;
    },
    setHeader(name: string, value: string | number) {
      headers.set(name.toLowerCase(), String(value));
      return this;
    },
    send(body: string) {
      stream.end(body);
      return this;
    },
  });
}

function createBinaryResponseRecorder() {
  return {
    statusCode: 200,
    headers: new Map<string, string>(),
    body: Buffer.alloc(0),
    ended: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string | number) {
      this.headers.set(name.toLowerCase(), String(value));
      return this;
    },
    end(chunk?: string | Uint8Array) {
      if (typeof chunk === "string") {
        this.body = Buffer.from(chunk);
      } else if (chunk) {
        this.body = Buffer.from(chunk);
      }
      this.ended = true;
      return this;
    },
  };
}

void test("preserves absolute HLS origins when rewriting nested playlist resources", async () => {
  const session = createSession();
  const rootHandle = createMediaHandle();
  const rootResponse = createResponseRecorder();

  await proxyUpstreamMediaResponse(
    session,
    rootHandle,
    new globalThis.Response(
      "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1280000\nhttps://cdn.example.com/hls/720p/prog_index.m3u8?token=abc\n",
      {
        status: 200,
        headers: {
          "content-type": "application/vnd.apple.mpegurl",
        },
      }
    ),
    rootResponse as unknown as Response
  );

  assert.match(rootResponse.body, /\/api\/media\//);
  assert.equal(session.mediaHandles.size, 1);

  const childPlaylistHandle = [...session.mediaHandles.values()][0];
  assert(childPlaylistHandle);
  assert.equal(childPlaylistHandle.path, "https://cdn.example.com/hls/720p/prog_index.m3u8?token=abc");
  assert.equal(childPlaylistHandle.basePath, "https://cdn.example.com/hls/720p/");

  const childResponse = createResponseRecorder();
  await proxyUpstreamMediaResponse(
    session,
    childPlaylistHandle,
    new globalThis.Response(
      "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.key?sig=1\"\nsegment0.ts\n",
      {
        status: 200,
        headers: {
          "content-type": "application/vnd.apple.mpegurl",
        },
      }
    ),
    childResponse as unknown as Response
  );

  const handlePaths = [...session.mediaHandles.values()].map((handle) => handle.path);
  assert(handlePaths.includes("https://cdn.example.com/hls/720p/key.key?sig=1"));
  assert(handlePaths.includes("https://cdn.example.com/hls/720p/segment0.ts"));
});

void test("strips HLS start hints so editor seeks control playback position", async () => {
  const session = createSession();
  const handle = createMediaHandle();
  const response = createResponseRecorder();

  await proxyUpstreamMediaResponse(
    session,
    handle,
    new globalThis.Response(
      [
        "#EXTM3U",
        "#EXT-X-TARGETDURATION:1",
        "#EXT-X-START:TIME-OFFSET=1054.000000",
        "#EXTINF:1, nodesc",
        "segment0.ts",
        "#EXT-X-ENDLIST",
        "",
      ].join("\n"),
      {
        status: 200,
        headers: {
          "content-type": "application/vnd.apple.mpegurl",
        },
      }
    ),
    response as unknown as Response
  );

  assert.doesNotMatch(response.body, /#EXT-X-START/);
  assert.match(response.body, /#EXT-X-TARGETDURATION:1/);
  assert.match(response.body, /#EXTINF:1, nodesc/);
  assert.match(response.body, /\/api\/media\//);
  assert.equal(session.mediaHandles.size, 1);
});

void test("does not forward range requests for HLS playlists that Cliparr rewrites", () => {
  assert.equal(
    shouldForwardMediaRange(createMediaHandle({
      path: "/video/:/transcode/universal/start.m3u8?session=1",
    }), "bytes=148-"),
    undefined,
  );
  assert.equal(
    shouldForwardMediaRange(createMediaHandle({
      path: "/library/parts/1/file.mp4",
    }), "bytes=148-"),
    "bytes=148-",
  );
});

void test("does not attach provider auth to cross-origin absolute media handles", () => {
  assert.equal(shouldAttachProviderAuth(createMediaHandle({
    path: "/library/parts/1/file.mp4",
  })), true);

  assert.equal(shouldAttachProviderAuth(createMediaHandle({
    path: "https://cdn.example.com/hls/segment0.ts?sig=secret",
    basePath: "https://cdn.example.com/hls/",
  })), false);
});

void test("allows configured provider origins even when they are private", async () => {
  await assert.doesNotReject(async () => {
    await assertAllowedMediaHandleRequestUrl(createMediaHandle({
      baseUrl: "http://192.168.1.10:32400",
      path: "/video/master.m3u8",
    }));
  });
});

void test("rejects cross-origin HLS media handles to private addresses", async () => {
  await assert.rejects(
    () => assertAllowedMediaHandleRequestUrl(createMediaHandle({
      path: "http://127.0.0.1:8080/admin",
      basePath: "http://1.1.1.1/hls/",
    })),
    (err: unknown) =>
      err instanceof ApiError
      && err.status === 400
      && err.code === "media_proxy_unsafe_url"
      && err.message === "Media URL points at an unsafe internal address"
  );
});

void test("validates cross-origin media redirects before following them", async () => {
  const originalFetch = globalThis.fetch;
  let redirectMode: unknown;

  globalThis.fetch = (async (_input, init) => {
    redirectMode = init?.redirect;
    return new Response(null, {
      status: 302,
      headers: {
        location: "http://127.0.0.1/admin",
      },
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => fetchMediaHandleRequest(createMediaHandle({
        path: "http://1.1.1.1/hls/segment.ts",
        basePath: "http://1.1.1.1/hls/",
      })),
      (err: unknown) =>
        err instanceof ApiError
        && err.status === 400
        && err.code === "media_proxy_unsafe_url"
    );
    assert.equal(redirectMode, "manual");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("validates same-origin media redirects before following them", async () => {
  const originalFetch = globalThis.fetch;
  let redirectMode: unknown;

  globalThis.fetch = (async (_input, init) => {
    redirectMode = init?.redirect;
    return new Response(null, {
      status: 302,
      headers: {
        location: "http://127.0.0.1/admin",
      },
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => fetchMediaHandleRequest(createMediaHandle({
        baseUrl: "http://192.168.1.10:32400",
        path: "/library/parts/1/file.mp4",
      })),
      (err: unknown) =>
        err instanceof ApiError
        && err.status === 400
        && err.code === "media_proxy_unsafe_url"
    );
    assert.equal(redirectMode, "manual");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("strips provider auth headers from cross-origin media redirects", async () => {
  const originalFetch = globalThis.fetch;
  const requestHeaders: Headers[] = [];

  globalThis.fetch = (async (_input, init) => {
    requestHeaders.push(new Headers(init?.headers));
    if (requestHeaders.length === 1) {
      return new Response(null, {
        status: 302,
        headers: {
          location: "http://1.1.1.1/hls/segment.ts",
        },
      });
    }

    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
    });
  }) as typeof fetch;

  try {
    const response = await fetchMediaHandleRequest(createMediaHandle({
      baseUrl: "http://192.168.1.10:32400",
      path: "/video/master.m3u8",
    }), {
      headers: {
        accept: "video/mp2t",
        authorization: "MediaBrowser Token=secret",
        "x-plex-token": "secret",
      },
    });

    assert.equal(response.status, 200);
    assert.equal(requestHeaders.length, 2);
    assert.equal(requestHeaders[0]?.get("x-plex-token"), "secret");
    assert.equal(requestHeaders[1]?.get("x-plex-token"), null);
    assert.equal(requestHeaders[1]?.get("authorization"), null);
    assert.equal(requestHeaders[1]?.get("accept"), "video/mp2t");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("sanitizes logged media paths by stripping query strings", () => {
  assert.equal(
    sanitizeLoggedMediaPath("https://cdn.example.com/hls/segment0.ts?sig=secret#frag"),
    "https://cdn.example.com/hls/segment0.ts",
  );
  assert.equal(
    sanitizeLoggedMediaPath("/video/master.m3u8?token=abc"),
    "/video/master.m3u8",
  );
});

void test("does not throw when a proxied media stream terminates early", async () => {
  const session = createSession();
  const handle = createMediaHandle({
    path: "/library/parts/1/file.mp4",
  });
  const response = createStreamingResponseRecorder();

  const upstream = new globalThis.Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        queueMicrotask(() => {
          controller.error(new TypeError("terminated"));
        });
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "video/mp4",
      },
    }
  );

  await assert.doesNotReject(async () => {
    await proxyUpstreamMediaResponse(
      session,
      handle,
      upstream,
      response as unknown as Response
    );
  });
});

void test("does not forward upstream content length for streamed media responses", async () => {
  const session = createSession();
  const handle = createMediaHandle({
    path: "/library/parts/1/file.mp4",
  });
  const response = createStreamingResponseRecorder();

  await proxyUpstreamMediaResponse(
    session,
    handle,
    new globalThis.Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: {
        "content-length": "1",
        "content-type": "video/mp4",
      },
    }),
    response as unknown as Response
  );

  assert.equal(response.headers.get("content-length"), undefined);
  assert.equal(response.headers.get("content-type"), "video/mp4");
});

void test("uses buffered byte length for cached HLS-derived media responses", async () => {
  const session = createSession();
  const handle = createMediaHandle({
    id: "length-handle",
    path: "https://cdn.example.com/hls/segment0.ts",
    basePath: "https://cdn.example.com/hls/",
  });
  const response = createBinaryResponseRecorder();

  await proxyProviderMediaResponse(
    session,
    handle,
    {
      accept: "video/mp2t",
    },
    async () => new globalThis.Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: {
        "content-length": "1",
        "content-type": "video/mp2t",
      },
    }),
    response as unknown as Response,
  );

  assert.equal(response.headers.get("content-length"), "4");
  assert.deepEqual(response.body, Buffer.from([1, 2, 3, 4]));
});

void test("dedupes concurrent HLS-derived media requests for the same handle", async () => {
  const session = createSession();
  const handle = createMediaHandle({
    path: "https://cdn.example.com/hls/segment0.ts",
    basePath: "https://cdn.example.com/hls/",
  });
  let fetchCount = 0;

  const createUpstreamResponse = async () => {
    fetchCount += 1;
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    return new globalThis.Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: {
        "content-type": "video/mp2t",
      },
    });
  };

  const firstResponse = createBinaryResponseRecorder();
  const secondResponse = createBinaryResponseRecorder();

  await Promise.all([
    proxyProviderMediaResponse(
      session,
      handle,
      {
        accept: "video/mp2t",
      },
      createUpstreamResponse,
      firstResponse as unknown as Response,
    ),
    proxyProviderMediaResponse(
      session,
      handle,
      {
        accept: "video/mp2t",
      },
      createUpstreamResponse,
      secondResponse as unknown as Response,
    ),
  ]);

  assert.equal(fetchCount, 1);
  assert.deepEqual(firstResponse.body, Buffer.from([1, 2, 3, 4]));
  assert.deepEqual(secondResponse.body, Buffer.from([1, 2, 3, 4]));
});
