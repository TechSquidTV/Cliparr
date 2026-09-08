import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { closeDatabase, initializeDatabase } from "@/db/database";
import { upsertProviderAccountByAccessToken } from "@/db/providerAccountsRepository";
import { errorHandler } from "@/http/errors";
import { mediaRouter } from "@/routes/media";
import { createProviderSession, getSessionCookieName } from "@/session/store";

const TEST_APP_KEY = "media-route-test-key-with-32-characters";

function fetchInputUrl(input: Parameters<typeof fetch>[0]) {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

async function withMediaApp<T>(
  callback: (baseUrl: string, sessionCookie: string) => Promise<T>,
) {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cliparr-media-route-"),
  );
  const previousAppKey = process.env.APP_KEY;
  const previousDataDir = process.env.CLIPARR_DATA_DIR;
  process.env.APP_KEY = TEST_APP_KEY;
  process.env.CLIPARR_DATA_DIR = dataDir;
  initializeDatabase();
  const account = upsertProviderAccountByAccessToken({
    providerId: "plex",
    label: "Media route test account",
    accessToken: "media-route-test-token",
  });
  assert.ok(account);
  const session = createProviderSession({
    providerId: "plex",
    providerAccountId: account.id,
    userToken: "media-route-test-token",
  });

  const app = express();
  app.use(express.json());
  app.use("/api/media", mediaRouter);
  app.use(errorHandler);

  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise((resolve) => {
      server.once("listening", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    return await callback(
      `http://127.0.0.1:${address.port}`,
      `${getSessionCookieName()}=${session.id}`,
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    closeDatabase();
    if (previousAppKey === undefined) {
      delete process.env.APP_KEY;
    } else {
      process.env.APP_KEY = previousAppKey;
    }
    if (previousDataDir === undefined) {
      delete process.env.CLIPARR_DATA_DIR;
    } else {
      process.env.CLIPARR_DATA_DIR = previousDataDir;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

void test("creates and proxies local URL media handles", async () => {
  await withMediaApp(async (baseUrl, sessionCookie) => {
    const createResponse = await fetch(`${baseUrl}/api/media/local-url`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sessionCookie,
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

    const unauthorizedProxyResponse = await fetch(
      `${baseUrl}${created.mediaUrl}`,
      {
        headers: {
          accept: "video/mp4",
          range: "bytes=0-3",
        },
      },
    );
    assert.equal(unauthorizedProxyResponse.status, 401);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const requestUrl = fetchInputUrl(input);

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
            cookie: sessionCookie,
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
  await withMediaApp(async (baseUrl, sessionCookie) => {
    const response = await fetch(`${baseUrl}/api/media/local-url`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sessionCookie,
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

void test("requires an account session for local URL media handles", async () => {
  await withMediaApp(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/media/local-url`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: "http://1.1.1.1/video.mp4",
      }),
    });

    assert.equal(response.status, 401);
    const body = (await response.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, "not_authenticated");
  });
});

void test("proxies redirected extensionless HLS through local URL handles with byte ranges", async () => {
  await withMediaApp(async (baseUrl, sessionCookie) => {
    const originalFetch = globalThis.fetch;
    const upstreamRequests: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = fetchInputUrl(input);
      if (!url.startsWith("http://1.1.1.1/")) {
        return originalFetch(input, init);
      }
      upstreamRequests.push(url);
      if (url === "http://1.1.1.1/live") {
        return new Response(null, {
          status: 302,
          headers: { location: "/moved/live" },
        });
      }
      if (url === "http://1.1.1.1/moved/live") {
        const playlist = new Response(
          "#EXTM3U\n#EXT-X-BYTERANGE:4@0\nmovie.ts\n",
          {
            headers: { "content-type": "application/vnd.apple.mpegurl" },
          },
        );
        Object.defineProperty(playlist, "url", { value: url });
        return playlist;
      }
      assert.equal(url, "http://1.1.1.1/moved/movie.ts");
      assert.equal(new Headers(init?.headers).get("range"), "bytes=0-3");
      return new Response("abcd", {
        status: 206,
        headers: {
          "content-type": "video/mp2t",
          "content-range": "bytes 0-3/1000000000",
        },
      });
    };
    try {
      const created = await originalFetch(`${baseUrl}/api/media/local-url`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sessionCookie },
        body: JSON.stringify({ url: "http://1.1.1.1/live" }),
      });
      assert.equal(created.status, 201);
      const { mediaUrl } = (await created.json()) as { mediaUrl: string };
      const playlist = await originalFetch(`${baseUrl}${mediaUrl}`, {
        headers: { cookie: sessionCookie },
      });
      assert.equal(playlist.status, 200);
      const playlistBody = await playlist.text();
      const child = playlistBody
        .split("\n")
        .find((line) => line.startsWith("/api/"));
      assert.match(child ?? "", /^\/api\/media\/local-url\//);
      const segment = await originalFetch(`${baseUrl}${child}`, {
        headers: { cookie: sessionCookie, range: "bytes=0-3" },
      });
      assert.equal(segment.status, 206);
      assert.equal(
        segment.headers.get("content-range"),
        "bytes 0-3/1000000000",
      );
      assert.equal(await segment.text(), "abcd");
      assert.deepEqual(upstreamRequests, [
        "http://1.1.1.1/live",
        "http://1.1.1.1/moved/live",
        "http://1.1.1.1/moved/movie.ts",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
