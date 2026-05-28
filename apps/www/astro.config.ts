import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://cliparr.dev",
  output: "static",
  markdown: {
    shikiConfig: {
      theme: "github-dark",
    },
  },
  integrations: [
    mdx(),
    sitemap({
      namespaces: {
        news: false,
        xhtml: false,
        image: false,
        video: false,
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
