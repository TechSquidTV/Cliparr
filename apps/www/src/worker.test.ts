import assert from "node:assert/strict";
import test from "node:test";
import worker from "@/worker";

function environment() {
  const requests: Request[] = [];
  const assetFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    const pathname = new URL(request.url).pathname;
    const isMissing = pathname.includes("missing");
    const isMarkdown = pathname.endsWith(".md");
    const content = isMarkdown ? "# Setup" : "<h1>Setup</h1>";
    const body = isMissing ? "Missing" : content;
    return new Response(request.method === "HEAD" ? null : body, {
      status: isMissing ? 404 : 200,
      headers: {
        "Content-Type": isMarkdown ? "text/plain" : "text/html",
        ETag: isMarkdown ? '"markdown"' : '"html"',
        "X-Content-Type-Options": "nosniff",
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
});

void test("HTML remains default and missing assets retain 404 status and headers", async () => {
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
  assert.equal(await missing.text(), "Missing");
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
