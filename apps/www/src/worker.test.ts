import assert from "node:assert/strict";
import test from "node:test";
import { notFoundMarkdown } from "@/lib/notFound";
import worker from "@/worker";

function environment() {
  const requests: Request[] = [];
  const assetFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    const pathname = new URL(request.url).pathname;
    const isMarkdown = pathname.endsWith(".md");
    const isMissing =
      pathname.includes("missing") ||
      (isMarkdown &&
        ![
          "/index.md",
          "/docs/index.md",
          "/docs/setup/index.md",
          "/docs/getting-started/index.md",
        ].includes(pathname));
    const content = isMarkdown ? "# Setup" : "<h1>Setup</h1>";
    const body = isMissing
      ? "<!doctype html><h1>Page not found</h1><script>errorPageScript()</script>"
      : content;
    return new Response(request.method === "HEAD" ? null : body, {
      status: isMissing ? 404 : 200,
      headers: {
        "Content-Type": isMarkdown && !isMissing ? "text/plain" : "text/html",
        ETag: isMarkdown ? '"markdown"' : '"html"',
        "Content-Length": String(body.length),
        "X-Content-Type-Options": "nosniff",
        ...(isMarkdown
          ? {
              "Content-Signal": "ai-train=yes, search=yes, ai-input=yes",
              Link: '</llms.txt>; rel="describedby"',
            }
          : {}),
      },
    });
  };
  return { requests, ASSETS: { fetch: assetFetch } };
}

void test("same URL negotiates Markdown without leaking HTML validators or range", async () => {
  const env = environment();
  const response = await worker.fetch(
    new Request("https://cliparr.dev/docs/setup/", {
      headers: {
        Accept: "text/markdown",
        "If-None-Match": '"html"',
        Range: "bytes=0-10",
      },
    }),
    env,
  );
  assert.equal(await response.text(), "# Setup");
  assert.equal(
    response.headers.get("Content-Type"),
    "text/markdown; charset=utf-8",
  );
  assert.equal(response.headers.get("Vary"), "Accept");
  assert.equal(response.headers.get("ETag"), '"markdown"');
  assert.equal(
    response.headers.get("Cloudflare-CDN-Cache-Control"),
    "no-store",
  );
  assert.equal(env.requests[0]?.headers.get("If-None-Match"), null);
  assert.equal(env.requests[0]?.headers.get("Range"), null);
  assert.equal(new URL(env.requests[0]!.url).pathname, "/docs/setup/index.md");
  assert.equal(
    response.headers.get("Link"),
    '</llms.txt>; rel="describedby", <https://cliparr.dev/docs/setup/>; rel="canonical"',
  );
});

void test("HTML remains default and missing Markdown never falls back to HTML", async () => {
  const env = environment();
  const html = await worker.fetch(new Request("https://cliparr.dev/"), env);
  assert.equal(html.headers.get("Content-Type"), "text/html");
  assert.equal(html.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(html.headers.get("Vary"), "Accept");
  assert.equal(await html.text(), "<h1>Setup</h1>");
  const missing = await worker.fetch(
    new Request("https://cliparr.dev/missing", {
      headers: { Accept: "text/markdown" },
    }),
    env,
  );
  assert.equal(missing.status, 404);
  const body = await missing.text();
  assert.equal(body, notFoundMarkdown);
  assert.ok(body.startsWith("# Page not found\n"));
  assert.ok(body.includes("https://cliparr.dev/llms.txt"));
  assert.ok(body.includes("https://cliparr.dev/docs.md"));
  assert.ok(body.includes("https://cliparr.dev/index.md"));
  assert.ok(body.includes("https://cliparr.dev/convert.md"));
  assert.doesNotMatch(body, /<script|<!doctype|<html/iu);
  assert.ok(body.length < 1024);
  assert.equal(missing.headers.get("X-Robots-Tag"), "noindex");
  assert.equal(
    missing.headers.get("Content-Type"),
    "text/markdown; charset=utf-8",
  );
  assert.equal(missing.headers.get("ETag"), null);
  assert.equal(missing.headers.get("Content-Length"), null);
  assert.equal(missing.headers.get("X-Content-Type-Options"), "nosniff");
  assert.doesNotMatch(missing.headers.get("Link") ?? "", /canonical/u);
  assert.equal(env.requests.length, 2);
});

void test("public .md URLs rewrite internally and canonicalize to production HTML", async () => {
  for (const [publicPath, assetPath, canonicalPath] of [
    ["/index.md", "/index.md", "/"],
    ["/docs.md", "/docs/index.md", "/docs/"],
    [
      "/docs/getting-started.md",
      "/docs/getting-started/index.md",
      "/docs/getting-started/",
    ],
  ] as const) {
    const env = environment();
    const response = await worker.fetch(
      new Request(`https://preview.workers.dev${publicPath}?ref=test`, {
        headers: { Accept: "text/html", "If-None-Match": '"old-markdown"' },
      }),
      env,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Location"), null);
    assert.equal(
      response.headers.get("Content-Type"),
      "text/markdown; charset=utf-8",
    );
    assert.equal(
      response.headers.get("Link"),
      `</llms.txt>; rel="describedby", <https://cliparr.dev${canonicalPath}>; rel="canonical"`,
    );
    assert.equal(
      response.headers.get("Content-Signal"),
      "ai-train=yes, search=yes, ai-input=yes",
    );
    assert.equal(await response.text(), "# Setup");
    assert.equal(env.requests.length, 1);
    assert.equal(new URL(env.requests[0]!.url).pathname, assetPath);
    assert.equal(
      env.requests[0]!.headers.get("If-None-Match"),
      '"old-markdown"',
    );
  }
});

void test("direct Markdown misses and old storage URLs return clean 404s, including HEAD", async () => {
  for (const pathname of [
    "/missing.md",
    "/docs/missing.md",
    "/docs/setup/index.md",
  ]) {
    for (const method of ["GET", "HEAD"]) {
      const env = environment();
      const response = await worker.fetch(
        new Request(`https://cliparr.dev${pathname}`, { method }),
        env,
      );
      assert.equal(response.status, 404);
      assert.equal(
        response.headers.get("Content-Type"),
        "text/markdown; charset=utf-8",
      );
      assert.equal(
        await response.text(),
        method === "HEAD" ? "" : notFoundMarkdown,
      );
      assert.equal(response.headers.get("ETag"), null);
      assert.equal(response.headers.get("Content-Length"), null);
      assert.equal(response.headers.get("X-Robots-Tag"), "noindex");
      assert.doesNotMatch(response.headers.get("Link") ?? "", /canonical/u);
    }
  }
});

void test("HTML misses keep the custom page and status regardless of user agent", async () => {
  for (const userAgent of ["Mozilla/5.0", "GPTBot"]) {
    const env = environment();
    const response = await worker.fetch(
      new Request("https://cliparr.dev/docs/missing/", {
        headers: { Accept: "text/html", "User-Agent": userAgent },
      }),
      env,
    );
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Content-Type"), "text/html");
    assert.equal(response.headers.get("Location"), null);
    assert.match(await response.text(), /<h1>Page not found<\/h1>/u);
    assert.equal(new URL(env.requests[0]!.url).pathname, "/docs/missing/");
  }
});

void test("direct Markdown preserves bodyless conditional responses and partial content", async () => {
  for (const status of [304, 206]) {
    const response = await worker.fetch(
      new Request("https://cliparr.dev/docs/setup.md"),
      {
        ASSETS: {
          fetch: async () =>
            new Response(status === 304 ? null : "# Set", {
              status,
              headers: {
                ETag: '"markdown"',
                ...(status === 206 ? { "Content-Range": "bytes 0-4/7" } : {}),
              },
            }),
        },
      },
    );
    assert.equal(response.status, status);
    assert.equal(response.headers.get("ETag"), '"markdown"');
    assert.equal(await response.text(), status === 304 ? "" : "# Set");
    assert.equal(
      response.headers.get("Content-Range"),
      status === 206 ? "bytes 0-4/7" : null,
    );
    assert.match(response.headers.get("Link") ?? "", /rel="canonical"/u);
  }
});

void test("upstream Markdown errors remain errors without exposing HTML", async () => {
  const response = await worker.fetch(
    new Request("https://cliparr.dev/docs.md"),
    {
      ASSETS: {
        fetch: async () =>
          new Response("<script>error()</script>", { status: 500 }),
      },
    },
  );
  assert.equal(response.status, 500);
  assert.equal(await response.text(), "# Unable to serve Markdown\n");
  assert.doesNotMatch(response.headers.get("Link") ?? "", /canonical/u);
});

void test("HEAD has no body; runtime configuration and non-page assets bypass negotiation", async () => {
  const env = environment();
  const head = await worker.fetch(
    new Request("https://cliparr.dev/", {
      method: "HEAD",
      headers: { Accept: "text/markdown" },
    }),
    env,
  );
  assert.equal(await head.text(), "");
  assert.match(head.headers.get("Content-Type") ?? "", /text\/markdown/u);
  const config = await worker.fetch(
    new Request("https://cliparr.dev/__cliparr/runtime-config.json"),
    { ...env, SENTRY_DSN: " test " },
  );
  assert.equal(await config.text(), '{"sentryDsn":"test"}');
  await worker.fetch(
    new Request("https://cliparr.dev/robots.txt", {
      headers: { Accept: "text/markdown" },
    }),
    env,
  );
  assert.equal(new URL(env.requests.at(-1)!.url).pathname, "/robots.txt");
});
