import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import sentry from "@sentry/astro";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import path from "node:path";
import rehypeMermaid from "rehype-mermaid";

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
    rehypePlugins: [
      [
        rehypeMermaid,
        {
          mermaidConfig: {
            flowchart: {
              curve: "basis",
              htmlLabels: false,
            },
            fontFamily: "Outfit Variable, ui-sans-serif, sans-serif",
            theme: "base",
            themeVariables: {
              background: "#111111",
              clusterBkg: "#141414",
              clusterBorder: "#4b5563",
              edgeLabelBackground: "#111111",
              lineColor: "#cbd5e1",
              mainBkg: "#1f2937",
              nodeBorder: "#6b7280",
              primaryBorderColor: "#6b7280",
              primaryColor: "#1f2937",
              primaryTextColor: "#f8fafc",
              secondaryBorderColor: "#6b7280",
              secondaryColor: "#111827",
              secondaryTextColor: "#f8fafc",
              textColor: "#f8fafc",
              tertiaryBorderColor: "#6b7280",
              tertiaryColor: "#111827",
              tertiaryTextColor: "#f8fafc",
            },
          },
          strategy: "pre-mermaid",
        },
      ],
    ],
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
  ],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: [
        "@mediabunny/aac-encoder",
        "@mediabunny/ac3",
        "@techsquidtv/gifenc",
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
