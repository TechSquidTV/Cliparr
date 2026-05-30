import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { docsSectionIds } from "@/data/docs";
import { githubReleasesLoader } from "@/lib/githubReleases";

const docs = defineCollection({
  loader: glob({
    base: "./src/content/docs",
    pattern: "**/*.{md,mdx}",
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    section: z.enum(docsSectionIds),
    order: z.number(),
  }),
});

const releases = defineCollection({
  loader: githubReleasesLoader(),
  schema: z.object({
    releaseId: z.number(),
    url: z.url(),
    tagName: z.string(),
    name: z.string(),
    title: z.string(),
    prerelease: z.boolean(),
    publishedAt: z.iso.datetime(),
  }),
});

export const collections = { docs, releases };
