import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import sentry from "@sentry/astro";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import path from "node:path";
// Astro loads configuration before resolving the app's path aliases.
// eslint-disable-next-line no-restricted-imports
import markdownExport from "./src/lib/markdownExport";

const configDirectory = import.meta.dirname;

export default defineConfig({
  site: "https://cliparr.dev",
  output: "static",
  markdown: {
    syntaxHighlight: {
      type: "shiki",
      excludeLangs: ["mermaid"],
    },
    shikiConfig: {
      theme: "github-dark",
    },
  },
  integrations: [
    mdx(),
    react(),
    sitemap({
      namespaces: {
        news: false,
        xhtml: false,
        image: false,
        video: false,
      },
    }),
    sentry(),
    markdownExport(),
  ],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: [
        "@mediabunny/aac-encoder",
        "@mediabunny/ac3",
        "@techsquidtv/gifenc",
        "lucide-react",
        "mediabunny",
      ],
    },
    resolve: {
      alias: {
        "@": path.resolve(configDirectory, "src"),
      },
    },
  },
});
