import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { site as productSite } from "@/data/product";

interface ReleaseFeedEntry {
  data: {
    isLatest: boolean;
    prerelease: boolean;
    publishedAt: string;
    tagName: string;
    title: string;
  };
  id: string;
}

const compareReleases = (a: ReleaseFeedEntry, b: ReleaseFeedEntry) =>
  Date.parse(b.data.publishedAt) - Date.parse(a.data.publishedAt);

export const GET: APIRoute = async ({ site }) => {
  const releases = (
    (await getCollection("releases")) as ReleaseFeedEntry[]
  ).toSorted(compareReleases);

  return rss({
    title: `${productSite.name} releases`,
    description:
      "Release notes for Cliparr, including new features, fixes, Docker tags, and upgrade notes.",
    site: site ?? productSite.url,
    items: releases.map((entry) => ({
      title: `${entry.data.tagName}: ${entry.data.title}`,
      description: entry.data.prerelease
        ? `Prerelease notes for Cliparr ${entry.data.tagName}.`
        : `Release notes for Cliparr ${entry.data.tagName}.`,
      pubDate: new Date(entry.data.publishedAt),
      link: `/changelog/#${entry.id}`,
      categories: [
        entry.data.prerelease ? "Prerelease" : "Release",
        ...(entry.data.isLatest ? ["Latest"] : []),
      ],
    })),
    customData: "<language>en-us</language>",
  });
};
