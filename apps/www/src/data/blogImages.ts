import type { ImageMetadata } from "astro";
import type { BlogHeroImageId } from "@/data/blog";

const blogHeroImagePaths = {
  "what-is-cliparr-hero": "../assets/blog/what-is-cliparr/hero.webp",
  "convert-video-in-your-browser-hero":
    "../assets/blog/convert-video-in-your-browser/hero.webp",
} satisfies Record<BlogHeroImageId, string>;

const blogHeroImageModules = import.meta.glob<{ default: ImageMetadata }>(
  "../assets/blog/**/*.{avif,jpeg,jpg,png,webp}",
  {
    eager: true,
  },
);

export function blogHeroImageFor(id: BlogHeroImageId | undefined) {
  if (!id) {
    return;
  }

  return blogHeroImageModules[blogHeroImagePaths[id]]?.default;
}
