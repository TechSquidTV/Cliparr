import { markdownPath, prefersMarkdown } from "@/lib/markdown";

interface WorkerEnvironment {
  ASSETS: { fetch: typeof fetch };
  SENTRY_DSN?: string;
}

export default {
  async fetch(request: Request, env: WorkerEnvironment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__cliparr/runtime-config.json") {
      return Response.json(
        { sentryDsn: env.SENTRY_DSN?.trim() || null },
        {
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    if (
      !["GET", "HEAD"].includes(request.method) ||
      /\/[^/]+\.[^/]+$/u.test(url.pathname)
    ) {
      return env.ASSETS.fetch(request);
    }
    let response: Response | undefined;
    if (prefersMarkdown(request.headers.get("Accept"))) {
      url.pathname = markdownPath(url.pathname);
      const headers = new Headers(request.headers);
      // Validators and ranges from HTML must not be applied to the Markdown asset.
      for (const name of [
        "If-None-Match",
        "If-Modified-Since",
        "Range",
        "If-Range",
      ]) {
        headers.delete(name);
      }
      const markdown = await env.ASSETS.fetch(
        new Request(url, { method: request.method, headers }),
      );
      if (markdown.ok) {
        response = new Response(markdown.body, markdown);
        response.headers.set("Content-Type", "text/markdown; charset=utf-8");
      }
    }
    response ??= await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    const vary = headers.get("Vary");
    headers.set("Vary", vary ? `${vary}, Accept` : "Accept");
    // Cloudflare's shared cache does not generally key on arbitrary Vary values.
    // The ASSETS binding still caches each underlying file by its distinct path.
    headers.set("Cloudflare-CDN-Cache-Control", "no-store");
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    return new Response(request.method === "HEAD" ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
