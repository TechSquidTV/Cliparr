import type { APIRoute } from "astro";
import { site as productSite } from "@/data/product";

const getRobotsTxt = (sitemapUrl: URL) => `User-agent: *
Allow: /
Content-Signal: ai-train=no, search=yes, ai-input=yes

Sitemap: ${sitemapUrl.href}
`;

export const GET: APIRoute = ({ site }) => {
  const sitemapUrl = new URL("sitemap-index.xml", site ?? productSite.url);

  return new Response(getRobotsTxt(sitemapUrl), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
};
