import { createHash } from "node:crypto";
import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export function offlineEditorAssets() {
  let base;
  return {
    name: "cliparr-offline-editor",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    async writeBundle({ dir }) {
      for (const file of [
        "logo-light.svg",
        "favicon.png",
        "pwa-icon-192.png",
        "pwa-icon-512.png",
        "editor.webmanifest",
      ]) {
        await copyFile(
          new URL(
            file === "editor.webmanifest" ? file : `../../public/${file}`,
            import.meta.url,
          ),
          path.join(dir, file),
        );
      }
      const template = await readFile(
        new URL("service-worker.js", import.meta.url),
        "utf8",
      );
      const hash = createHash("sha256").update(base).update(template);
      const urls = [];
      const entries = await readdir(dir, {
        recursive: true,
        withFileTypes: true,
      });
      const files = entries
        .filter((entry) => entry.isFile())
        .map((entry) =>
          path
            .relative(dir, path.join(entry.parentPath, entry.name))
            .split(path.sep)
            .join("/"),
        )
        .toSorted();
      for (const name of files) {
        hash.update(name).update(await readFile(path.join(dir, name)));
        urls.push(name === "index.html" ? base : `${base}${name}`);
      }
      const version = hash.digest("hex").slice(0, 16);
      await writeFile(
        path.join(dir, "service-worker.js"),
        `const CACHE_VERSION = ${JSON.stringify(version)};\nconst ASSET_URLS = ${JSON.stringify(urls)};\n${template}`,
      );
    },
  };
}
