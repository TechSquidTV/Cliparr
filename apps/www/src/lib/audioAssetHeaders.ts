import { appendFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { AstroIntegration } from "astro";

export default function audioAssetHeaders() {
  return {
    name: "cliparr-audio-asset-headers",
    hooks: {
      "astro:build:done": async ({ dir }: { dir: URL }) => {
        const audioDirectory = new URL("audio/", dir);
        const files = await readdir(audioDirectory, { recursive: true });
        const rules = await Promise.all(
          files
            .filter((file) => file.endsWith(".mp3"))
            .toSorted()
            .map(async (file) => {
              const pathname = file
                .split(path.sep)
                .map((segment) => encodeURIComponent(segment))
                .join("/");
              const { size } = await stat(new URL(pathname, audioDirectory));
              return `/audio/${pathname}\n  Content-Length: ${size}\n`;
            }),
        );
        // ASSETS omits Content-Length inside the Worker unless explicitly set.
        // Publish build-derived sizes so seeking can stream without buffering the file.
        await appendFile(new URL("_headers", dir), `\n${rules.join("\n")}`);
      },
    },
  } satisfies AstroIntegration;
}
