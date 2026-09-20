import { markdownAssetPath, prefersMarkdown } from "@/lib/markdown";
import { notFoundMarkdown } from "@/lib/notFound";
import { canonicalSiteUrl } from "@/lib/structuredData";

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
    const directMarkdown = url.pathname.endsWith(".md");
    if (
      !["GET", "HEAD"].includes(request.method) ||
      (!directMarkdown && /\/[^/]+\.[^/]+$/u.test(url.pathname))
    ) {
      return env.ASSETS.fetch(request);
    }
    let response: Response | undefined;
    if (directMarkdown || prefersMarkdown(request.headers.get("Accept"))) {
      let pagePath = url.pathname;
      if (directMarkdown) {
        pagePath =
          url.pathname === "/index.md" ? "/" : url.pathname.slice(0, -3);
      }
      url.pathname = markdownAssetPath(pagePath);
      const headers = new Headers(request.headers);
      // Validators and ranges from HTML must not be applied to the Markdown asset.
      if (!directMarkdown) {
        for (const name of [
          "If-None-Match",
          "If-Modified-Since",
          "Range",
          "If-Range",
        ]) {
          headers.delete(name);
        }
      }
      const markdown = await env.ASSETS.fetch(
        new Request(url, { method: request.method, headers }),
      );
      const markdownHeaders = new Headers(markdown.headers);
      markdownHeaders.set("Content-Type", "text/markdown; charset=utf-8");
      if (markdown.status >= 400) {
        markdownHeaders.set("X-Robots-Tag", "noindex");
        // ASSETS returns the site's HTML error page for missing files.
        // Never expose that layout (or its validators) as Markdown.
        for (const name of [
          "ETag",
          "Last-Modified",
          "Content-Length",
          "Content-Encoding",
          "Content-Range",
        ]) {
          markdownHeaders.delete(name);
        }
        response = new Response(
          markdown.status === 404
            ? notFoundMarkdown
            : "# Unable to serve Markdown\n",
          { status: markdown.status, headers: markdownHeaders },
        );
      } else {
        markdownHeaders.append(
          "Link",
          `<${canonicalSiteUrl(pagePath)}>; rel="canonical"`,
        );
        response = new Response(markdown.body, {
          status: markdown.status,
          statusText: markdown.statusText,
          headers: markdownHeaders,
        });
      }
    }
    response ??= await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    if (!directMarkdown) {
      const vary = headers.get("Vary");
      headers.set("Vary", vary ? `${vary}, Accept` : "Accept");
    }
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
