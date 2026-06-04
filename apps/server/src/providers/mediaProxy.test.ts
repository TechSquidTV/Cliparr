import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import type { Response } from "express";
import { createApiError, isApiError } from "@/http/errors";
import type { ProviderSessionRecord } from "@/session/store";
import type { MediaHandle } from "@/providers/types";
import {
  assertAllowedMediaHandleRequestUrl,
  fetchMediaHandleRequest,
  hlsPlaylistRewriteDiagnosticFields,
  mediaHandleHlsDiagnosticFields,
  proxyProviderMediaResponse,
  proxyUpstreamMediaResponse,
  sanitizeLoggedMediaPath,
  shouldAttachProviderAuth,
  shouldForwardMediaRange,
} from "@/providers/shared/mediaProxy";

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
  const recorder = {
    statusCode: 200,
    headers: new Map<string, string>(),
    body: "",
    ended: false,
    status(code: number) {
      recorder.statusCode = code;
      return recorder;
    },
    setHeader(name: string, value: string | number) {
      recorder.headers.set(name.toLowerCase(), String(value));
      return recorder;
    },
    send(body: string) {
      recorder.body = body;
      return recorder;
    },
    end() {
      recorder.ended = true;
      return recorder;
    },
  };

  return recorder;
}

function createStreamingResponseRecorder() {
  const stream = new PassThrough();
  const headers = new Map<string, string>();
  let statusCode = 200;
  stream.resume();

  const recorder = Object.assign(stream, {
    get statusCode() {
      return statusCode;
    },
    set statusCode(value: number) {
      statusCode = value;
    },
    headers,
    status(code: number) {
      statusCode = code;
      return recorder;
    },
    setHeader(name: string, value: string | number) {
      headers.set(name.toLowerCase(), String(value));
      return recorder;
    },
    send(body: string) {
      stream.end(body);
      return recorder;
    },
  });

  return recorder;
}

function createBinaryResponseRecorder() {
  const recorder = {
    statusCode: 200,
    headers: new Map<string, string>(),
    body: Buffer.alloc(0),
    ended: false,
    status(code: number) {
      recorder.statusCode = code;
      return recorder;
    },
    setHeader(name: string, value: string | number) {
      recorder.headers.set(name.toLowerCase(), String(value));
      return recorder;
    },
    end(chunk?: string | Uint8Array) {
      if (typeof chunk === "string") {
        recorder.body = Buffer.from(chunk);
      } else if (chunk) {
        recorder.body = Buffer.from(chunk);
      }
      recorder.ended = true;
      return recorder;
    },
  };

  return recorder;
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
      },
    ),
    rootResponse as unknown as Response,
  );

  assert.match(rootResponse.body, /\/api\/media\//);
  assert.equal(session.mediaHandles.size, 1);

  const childPlaylistHandle = [...session.mediaHandles.values()][0];
  assert(childPlaylistHandle);
  assert.equal(
    childPlaylistHandle.path,
    "https://cdn.example.com/hls/720p/prog_index.m3u8?token=abc",
  );
  assert.equal(
    childPlaylistHandle.basePath,
    "https://cdn.example.com/hls/720p/",
  );

  const childResponse = createResponseRecorder();
  await proxyUpstreamMediaResponse(
    session,
    childPlaylistHandle,
    new globalThis.Response(
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.key?sig=1"\nsegment0.ts\n',
      {
        status: 200,
        headers: {
          "content-type": "application/vnd.apple.mpegurl",
        },
      },
    ),
    childResponse as unknown as Response,
  );

  const handlePaths = [...session.mediaHandles.values()].map(
    (handle) => handle.path,
  );
  assert(
    handlePaths.includes("https://cdn.example.com/hls/720p/key.key?sig=1"),
  );
  assert(handlePaths.includes("https://cdn.example.com/hls/720p/segment0.ts"));
});

void test("uses custom media handle URLs when rewriting HLS playlists", async () => {
  const session = createSession();
  const rootHandle = createMediaHandle({
    path: "https://cdn.example.com/hls/master.m3u8",
    basePath: "https://cdn.example.com/hls/",
  });
  const response = createResponseRecorder();
  const createdHandles: Array<{ nextPath: string; basePath: string }> = [];

  await proxyUpstreamMediaResponse(
    session,
    rootHandle,
    new globalThis.Response(
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.key?sig=1"\nsegment0.ts\n',
      {
        status: 200,
        headers: {
          "content-type": "application/vnd.apple.mpegurl",
        },
      },
    ),
    response as unknown as Response,
    {
      createMediaHandleUrl: (_session, _handle, nextPath, basePath) => {
        createdHandles.push({ nextPath, basePath });
        return `/api/media/local-url/${createdHandles.length}`;
      },
    },
  );

  assert.match(response.body, /\/api\/media\/local-url\/1/);
  assert.match(response.body, /\/api\/media\/local-url\/2/);
  assert.deepEqual(createdHandles, [
    {
      nextPath: "https://cdn.example.com/hls/key.key?sig=1",
      basePath: "https://cdn.example.com/hls/",
    },
    {
      nextPath: "https://cdn.example.com/hls/segment0.ts",
      basePath: "https://cdn.example.com/hls/",
    },
  ]);
});

void test("uses Plex path session ids for rewritten HLS handles", async () => {
  const session = createSession();
  const rootHandle = createMediaHandle({
    path: "/video/:/transcode/universal/start.m3u8?transcodeSessionId=cliparr-session-1",
    playbackSessionId: "cliparr-session-1",
  });
  const response = createResponseRecorder();

  await proxyUpstreamMediaResponse(
    session,
    rootHandle,
    new globalThis.Response(
      "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1280000\nsession/plex-path-session/base/index.m3u8\n",
      {
        status: 200,
        headers: {
          "content-type": "application/vnd.apple.mpegurl",
        },
      },
    ),
    response as unknown as Response,
  );

  assert.equal(session.mediaHandles.size, 1);
  const childHandle = [...session.mediaHandles.values()][0];
  assert.equal(childHandle?.playbackSessionId, "plex-path-session");
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
      },
    ),
    response as unknown as Response,
  );

  assert.doesNotMatch(response.body, /#EXT-X-START/);
  assert.match(response.body, /#EXT-X-TARGETDURATION:1/);
  assert.match(response.body, /#EXTINF:1, nodesc/);
  assert.match(response.body, /\/api\/media\//);
  assert.equal(session.mediaHandles.size, 1);
});

void test("does not forward range requests for HLS handles that Cliparr rewrites", () => {
  assert.equal(
    shouldForwardMediaRange(
      createMediaHandle({
        path: "/video/:/transcode/universal/start.m3u8?session=1",
      }),
      "bytes=148-",
    ),
    undefined,
  );
  assert.equal(
    shouldForwardMediaRange(
      createMediaHandle({
        path: "/video/:/transcode/universal/session/abc/base/00000.ts",
        basePath: "/video/:/transcode/universal/session/abc/base/",
      }),
      "bytes=148-",
    ),
    undefined,
  );
  assert.equal(
    shouldForwardMediaRange(
      createMediaHandle({
        path: "/library/parts/1/file.mp4",
      }),
      "bytes=148-",
    ),
    "bytes=148-",
  );
});

void test("does not attach provider auth to cross-origin absolute media handles", () => {
  assert.equal(
    shouldAttachProviderAuth(
      createMediaHandle({
        path: "/library/parts/1/file.mp4",
      }),
    ),
    true,
  );

  assert.equal(
    shouldAttachProviderAuth(
      createMediaHandle({
        path: "https://cdn.example.com/hls/segment0.ts?sig=secret",
        basePath: "https://cdn.example.com/hls/",
      }),
    ),
    false,
  );
});

void test("allows configured provider origins even when they are private", async () => {
  await assert.doesNotReject(async () => {
    await assertAllowedMediaHandleRequestUrl(
      createMediaHandle({
        baseUrl: "http://192.168.1.10:32400",
        path: "/video/master.m3u8",
      }),
    );
  });
});

void test("rejects cross-origin HLS media handles to private addresses", async () => {
  await assert.rejects(
    () =>
      assertAllowedMediaHandleRequestUrl(
        createMediaHandle({
          path: "http://127.0.0.1:8080/admin",
          basePath: "http://1.1.1.1/hls/",
        }),
      ),
    (err: unknown) =>
      isApiError(err) &&
      err.status === 400 &&
      err.code === "media_proxy_unsafe_url" &&
      err.message === "Media URL points at an unsafe internal address",
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
        location: "http://[::ffff:127.0.0.1]/admin",
      },
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        fetchMediaHandleRequest(
          createMediaHandle({
            path: "http://1.1.1.1/hls/segment.ts",
            basePath: "http://1.1.1.1/hls/",
          }),
        ),
      (err: unknown) =>
        isApiError(err) &&
        err.status === 400 &&
        err.code === "media_proxy_unsafe_url",
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
      () =>
        fetchMediaHandleRequest(
          createMediaHandle({
            baseUrl: "http://192.168.1.10:32400",
            path: "/library/parts/1/file.mp4",
          }),
        ),
      (err: unknown) =>
        isApiError(err) &&
        err.status === 400 &&
        err.code === "media_proxy_unsafe_url",
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
    const response = await fetchMediaHandleRequest(
      createMediaHandle({
        baseUrl: "http://192.168.1.10:32400",
        path: "/video/master.m3u8",
      }),
      {
        headers: {
          accept: "video/mp2t",
          authorization: "MediaBrowser Token=secret",
          "x-plex-token": "secret",
        },
      },
    );

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

void test("retries transient media fetch failures", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  globalThis.fetch = (async () => {
    fetchCount += 1;
    if (fetchCount === 1) {
      throw new TypeError("fetch failed");
    }

    return new Response("ok", {
      status: 200,
    });
  }) as typeof fetch;

  try {
    const response = await fetchMediaHandleRequest(
      createMediaHandle({
        path: "/library/parts/1/file.mp4",
      }),
      {
        retryBaseDelayMs: 0,
      },
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
    assert.equal(fetchCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("retries retryable upstream media responses", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  globalThis.fetch = (async () => {
    fetchCount += 1;

    return new Response(fetchCount === 1 ? "busy" : "ok", {
      status: fetchCount === 1 ? 503 : 200,
    });
  }) as typeof fetch;

  try {
    const response = await fetchMediaHandleRequest(
      createMediaHandle({
        path: "/library/parts/1/file.mp4",
      }),
      {
        retryBaseDelayMs: 0,
      },
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
    assert.equal(fetchCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("does not retry non-transient upstream media responses", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  globalThis.fetch = (async () => {
    fetchCount += 1;

    return new Response("missing", {
      status: 404,
    });
  }) as typeof fetch;

  try {
    const response = await fetchMediaHandleRequest(
      createMediaHandle({
        path: "/library/parts/1/file.mp4",
      }),
      {
        retryBaseDelayMs: 0,
      },
    );

    assert.equal(response.status, 404);
    assert.equal(await response.text(), "missing");
    assert.equal(fetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("retries not-yet-generated HLS-derived media responses", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  globalThis.fetch = (async () => {
    fetchCount += 1;

    return new Response(fetchCount < 3 ? "missing" : "ok", {
      status: fetchCount < 3 ? 404 : 200,
    });
  }) as typeof fetch;

  try {
    const response = await fetchMediaHandleRequest(
      createMediaHandle({
        path: "/hls/segment0.ts",
        basePath: "/hls/",
      }),
      {
        retryBaseDelayMs: 0,
      },
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
    assert.equal(fetchCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("keeps retrying delayed HLS-derived 404 responses", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  globalThis.fetch = (async () => {
    fetchCount += 1;

    return new Response(fetchCount < 7 ? "missing" : "ok", {
      status: fetchCount < 7 ? 404 : 200,
    });
  }) as typeof fetch;

  try {
    const response = await fetchMediaHandleRequest(
      createMediaHandle({
        path: "/hls/segment0.ts",
        basePath: "/hls/",
      }),
      {
        retryBaseDelayMs: 0,
      },
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
    assert.equal(fetchCount, 7);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("sanitizes logged media paths by stripping query strings", () => {
  assert.equal(
    sanitizeLoggedMediaPath(
      "https://cdn.example.com/hls/segment0.ts?sig=secret#frag",
    ),
    "https://cdn.example.com/hls/segment0.ts",
  );
  assert.equal(
    sanitizeLoggedMediaPath("/video/master.m3u8?token=abc"),
    "/video/master.m3u8",
  );
});

void test("builds sanitized HLS playlist rewrite diagnostics", () => {
  const fields = hlsPlaylistRewriteDiagnosticFields(
    createMediaHandle({
      id: "playlist-handle",
      path: "https://cdn.example.com/hls/master.m3u8?token=secret",
    }),
    "https://cdn.example.com/hls/?token=secret",
    200,
    {
      firstPlaylistPath: "https://cdn.example.com/hls/child.m3u8?sig=secret",
      firstSegmentPath: "https://cdn.example.com/hls/00000.ts?sig=secret",
      keyUriCount: 1,
      playlistUriCount: 1,
      rewrittenUriCount: 3,
      segmentUriCount: 1,
      strippedStartHintCount: 1,
    },
  );

  assert.equal(fields["event.name"], "media.hls.playlist_rewrite");
  assert.equal(fields["event.outcome"], "success");
  assert.equal(fields["media.handle.id"], "playlist-handle");
  assert.equal(fields["provider.id"], "plex");
  assert.equal(fields["source.id"], "source-1");
  assert.equal(fields["media.path"], "https://cdn.example.com/hls/master.m3u8");
  assert.equal(fields["media.base_path"], "https://cdn.example.com/hls/");
  assert.equal(fields["upstream.status_code"], 200);
  assert.equal(fields["media.hls.rewritten_uri_count"], 3);
  assert.equal(fields["media.hls.segment_uri_count"], 1);
  assert.equal(fields["media.hls.playlist_uri_count"], 1);
  assert.equal(fields["media.hls.key_uri_count"], 1);
  assert.equal(
    fields["media.hls.first_segment.path"],
    "https://cdn.example.com/hls/00000.ts",
  );
  assert.equal(
    fields["media.hls.first_playlist.path"],
    "https://cdn.example.com/hls/child.m3u8",
  );
  assert.equal(fields["media.hls.stripped_start_hint_count"], 1);
});

void test("builds HLS segment diagnostics from media handles", () => {
  const fields = mediaHandleHlsDiagnosticFields(
    createMediaHandle({
      path: "/video/:/transcode/universal/session/abc-123/base/00000.ts?token=secret",
      basePath:
        "/video/:/transcode/universal/session/abc-123/base/?token=secret",
    }),
  );

  assert.equal(
    fields["media.path"],
    "/video/:/transcode/universal/session/abc-123/base/00000.ts",
  );
  assert.equal(
    fields["media.base_path"],
    "/video/:/transcode/universal/session/abc-123/base/",
  );
  assert.equal(fields["media.hls.derived"], true);
  assert.equal(fields["media.hls.playlist"], false);
  assert.equal(fields["media.hls.segment"], true);
  assert.equal(fields["media.hls.segment.filename"], "00000.ts");
  assert.equal(fields["media.hls.segment.index"], 0);
  assert.equal(fields["plex.transcode.path_session.id"], "abc-123");
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
    },
  );

  await assert.doesNotReject(async () => {
    await proxyUpstreamMediaResponse(
      session,
      handle,
      upstream,
      response as unknown as Response,
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
    response as unknown as Response,
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
    async () =>
      new globalThis.Response(new Uint8Array([1, 2, 3, 4]), {
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
    id: "dedupe-hls-handle",
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

void test("cleans up rejected in-flight HLS responses without orphaned rejections", async () => {
  const session = createSession();
  const handle = createMediaHandle({
    id: "rejected-hls-handle",
    path: "https://cdn.example.com/hls/segment0.ts",
    basePath: "https://cdn.example.com/hls/",
  });
  const response = createBinaryResponseRecorder();

  await assert.rejects(
    proxyProviderMediaResponse(
      session,
      handle,
      {
        accept: "video/mp2t",
      },
      async () => {
        throw createApiError(404, "plex_media_failed", "segment missing");
      },
      response as unknown as Response,
    ),
    (err) => isApiError(err) && err.code === "plex_media_failed",
  );
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
});
