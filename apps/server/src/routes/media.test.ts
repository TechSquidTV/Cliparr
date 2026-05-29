import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { errorHandler } from "../http/errors.js";
import { mediaRouter } from "./media.js";

async function withMediaApp<T>(callback: (baseUrl: string) => Promise<T>) {
  const app = express();
  app.use(express.json());
  app.use("/api/media", mediaRouter);
  app.use(errorHandler);

  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert(address && typeof address === "object");
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve(undefined)));
    });
  }
}

void test("creates and proxies local URL media handles", async () => {
  await withMediaApp(async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/api/media/local-url`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: "http://1.1.1.1/video.mp4",
      }),
    });

    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()) as {
      mediaUrl?: string;
      hls?: boolean;
    };
    assert.match(created.mediaUrl ?? "", /^\/api\/media\/local-url\//);
    assert.equal(created.hls, false);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const requestUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (requestUrl.startsWith(baseUrl)) {
        return originalFetch(input, init);
      }

      assert.equal(requestUrl, "http://1.1.1.1/video.mp4");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("range"), "bytes=0-3");
      assert.equal(headers.get("accept"), "video/mp4");

      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 206,
        headers: {
          "accept-ranges": "bytes",
          "content-range": "bytes 0-3/4",
          "content-type": "video/mp4",
        },
      });
    }) as typeof fetch;

    try {
      const proxyResponse = await originalFetch(
        `${baseUrl}${created.mediaUrl}`,
        {
          headers: {
            accept: "video/mp4",
            range: "bytes=0-3",
          },
        },
      );
      assert.equal(proxyResponse.status, 206);
      assert.equal(proxyResponse.headers.get("content-type"), "video/mp4");
      assert.deepEqual(
        new Uint8Array(await proxyResponse.arrayBuffer()),
        new Uint8Array([1, 2, 3, 4]),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

void test("rejects local URL media handles for internal addresses", async () => {
  await withMediaApp(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/media/local-url`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: "http://127.0.0.1/video.mp4",
      }),
    });

    assert.equal(response.status, 400);
    const body = (await response.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, "media_proxy_unsafe_url");
  });
});
