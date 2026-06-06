import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { blogHeroImageIds, blogTagIds } from "@/data/blog";
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

const blog = defineCollection({
  loader: glob({
    base: "./src/content/blog",
    pattern: "**/*.{md,mdx}",
  }),
  schema: z
    .object({
      title: z.string(),
      seoTitle: z.string().optional(),
      description: z.string(),
      publishedAt: z.iso.date(),
      updatedAt: z.iso.date().optional(),
      tags: z.array(z.enum(blogTagIds)).default([]),
      heroImage: z.enum(blogHeroImageIds).optional(),
      heroImageAlt: z.string().optional(),
      author: z
        .object({
          name: z.string(),
          url: z.url().optional(),
        })
        .optional(),
    })
    .refine((data) => !data.heroImage || Boolean(data.heroImageAlt?.trim()), {
      message: "heroImageAlt is required when heroImage is set.",
      path: ["heroImageAlt"],
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
    isLatest: z.boolean(),
    publishedAt: z.iso.datetime(),
  }),
});

export const collections = { blog, docs, releases };
