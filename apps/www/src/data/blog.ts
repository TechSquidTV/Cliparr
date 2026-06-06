export interface BlogTag {
  label: string;
  slug: BlogTagId;
}

export const blogTagIds = ["guide", "jellyfin", "plex", "engineering"] as const;

export type BlogTagId = (typeof blogTagIds)[number];

const blogTagLabels = {
  guide: "Guide",
  jellyfin: "Jellyfin",
  plex: "Plex",
  engineering: "Engineering",
} satisfies Record<BlogTagId, string>;

export const blogHeroImageIds = ["what-is-cliparr-hero"] as const;

export type BlogHeroImageId = (typeof blogHeroImageIds)[number];

export function blogTagLabel(tag: BlogTagId) {
  return blogTagLabels[tag];
}

export function blogTagPath(tag: BlogTagId) {
  return `/blog/tags/${tag}`;
}

export function compareBlogPosts<
  T extends { data: { publishedAt: string }; id: string },
>(a: T, b: T) {
  const publishedOrder =
    Date.parse(b.data.publishedAt) - Date.parse(a.data.publishedAt);

  return publishedOrder || a.id.localeCompare(b.id);
}

export function blogTagsForEntries<
  T extends { data: { tags: readonly BlogTagId[] } },
>(entries: readonly T[]) {
  const tagsBySlug = new Map<BlogTagId, BlogTag>();

  for (const entry of entries) {
    for (const tag of entry.data.tags) {
      if (!tagsBySlug.has(tag)) {
        tagsBySlug.set(tag, { label: blogTagLabel(tag), slug: tag });
      }
    }
  }

  return [...tagsBySlug.values()].toSorted((a, b) =>
    a.label.localeCompare(b.label),
  );
}
