import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildScenes } from "#/scenes.ts";
import { writeCaptureAssets } from "#/write.ts";

void test("targeted writes replace the still pair without touching previews or docs", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "cliparr-write-stills-"),
  );
  const root = path.join(directory, "repo");
  const output = path.join(directory, "output");
  const scenes = buildScenes({ hero: "hero.mkv", mobile: "mobile.mkv" });
  const preserved = [
    "apps/www/public/docs/export-dialog.webp",
    "apps/www/public/docs/subtitle-panel.webp",
    ...scenes.flatMap((scene) =>
      [
        `${scene.videoName}.mp4`,
        `${scene.videoName}.webm`,
        `${scene.posterName}.webp`,
      ].map((name) => `apps/www/src/assets/${name}`),
    ),
  ];
  try {
    await mkdir(output, { recursive: true });
    for (const name of [
      ...preserved,
      ".github/img/screenshot.webp",
      "apps/www/public/og.jpg",
    ]) {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await writeFile(path.join(root, name), "original");
    }
    await writeFile(path.join(output, "readme.webp"), "new readme");
    await writeFile(path.join(output, "og.jpg"), "new social");
    await writeCaptureAssets(root, output, {
      target: "readme-social",
      scenes: scenes.slice(0, 1),
    });
    for (const name of preserved) {
      assert.equal(await readFile(path.join(root, name), "utf8"), "original");
    }
    assert.equal(
      await readFile(path.join(root, ".github/img/screenshot.webp"), "utf8"),
      "new readme",
    );
    assert.equal(
      await readFile(path.join(root, "apps/www/public/og.jpg"), "utf8"),
      "new social",
    );
    for (const name of preserved) {
      await writeFile(
        path.join(output, path.basename(name)),
        "new full capture",
      );
    }
    await writeCaptureAssets(root, output, { target: "all", scenes });
    for (const name of preserved) {
      assert.equal(
        await readFile(path.join(root, name), "utf8"),
        "new full capture",
      );
    }
    assert.equal(
      await readFile(path.join(root, ".github/img/screenshot.webp"), "utf8"),
      "new readme",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
