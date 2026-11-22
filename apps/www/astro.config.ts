import path from "node:path";

import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import sentry from "@sentry/astro/integration";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { createServer, type ViteDevServer } from "vite";

// Astro loads configuration before resolving the app's path aliases.
// eslint-disable-next-line no-restricted-imports
import audioAssetHeaders from "./src/lib/audioAssetHeaders";
// eslint-disable-next-line no-restricted-imports
import markdownExport from "./src/lib/markdownExport";

let editorDevelopmentServer: ViteDevServer | undefined;
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
    {
      name: "cliparr-local-editor",
      hooks: {
        "astro:server:setup": async ({ server }) => {
          editorDevelopmentServer = await createServer({
            mode: "try",
            configFile: path.resolve(
              configDirectory,
              "../frontend/vite.config.js",
            ),
            server: {
              middlewareMode: true,
              ws: server.httpServer
                ? { server: server.httpServer, path: "editor-hmr" }
                : false,
            },
          });
          const editor = editorDevelopmentServer;
          server.middlewares.use((request, res, next) => {
            if (request.url?.startsWith("/try/")) {
              editor.middlewares(request, res, next);
            } else if (request.url === "/try") {
              res.writeHead(307, { Location: "/try/" });
              res.end();
            } else {
              next();
            }
          });
        },
        "astro:server:done": async () => {
          await editorDevelopmentServer?.close();
        },
      },
    },
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
    audioAssetHeaders(),
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
