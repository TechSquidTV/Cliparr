import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";

const configDirectory = import.meta.dirname;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(configDirectory, "../.."), "");
  const apiPort = env.PORT || "3000";
  const apiTarget = env.CLIPARR_API_URL || `http://localhost:${apiPort}`;
  return {
    plugins: [
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
      }),
      react(),
      tailwindcss(),
    ],
    build: {
      // Lazy codec extension chunks are intentionally larger than Vite's default 500 kB warning.
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("/node_modules/mediabunny/dist/modules/src/")) {
              return;
            }

            if (id.includes("/codec-data.js")) {
              return "mediabunny-codec-data";
            }
            if (
              id.includes("/media-sink.js") ||
              id.includes("/media-source.js") ||
              id.includes("/sample.js")
            ) {
              return "mediabunny-media";
            }
          },
        },
      },
    },
    resolve: {
      dedupe: ["mediabunny"],
      alias: {
        "@": path.resolve(configDirectory, "src"),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== "true",
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
