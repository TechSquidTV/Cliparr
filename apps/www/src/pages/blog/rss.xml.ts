import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import type { CollectionEntry } from "astro:content";
import { getCollection } from "astro:content";
import { blogTagLabel, compareBlogPosts } from "@/data/blog";
import { site as productSite } from "@/data/product";

type BlogEntry = CollectionEntry<"blog">;

export const GET: APIRoute = async ({ site }) => {
  const posts = ((await getCollection("blog")) as BlogEntry[]).toSorted(
    compareBlogPosts,
  );

  return rss({
    title: `${productSite.name} blog`,
    description:
      "Updates, notes, and practical guides for clipping personal media with Cliparr.",
    site: site ?? productSite.url,
    items: posts.map((entry) => ({
      title: entry.data.title,
      description: entry.data.description,
      pubDate: new Date(entry.data.publishedAt),
      link: `/blog/${entry.id}`,
      categories: entry.data.tags.map((tag) => blogTagLabel(tag)),
    })),
    customData: "<language>en-us</language>",
  });
};
