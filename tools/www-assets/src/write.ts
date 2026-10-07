import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { CapturePlan } from "#/scenes.ts";

/** Publish only the assets requested by this capture; report.json is written after validation. */
export async function writeCaptureAssets(
  root: string,
  output: string,
  plan: CapturePlan,
) {
  if (plan.target === "all") {
    for (const scene of plan.scenes) {
      for (const name of [
        `${scene.videoName}.mp4`,
        `${scene.videoName}.webm`,
        `${scene.posterName}.webp`,
      ]) {
        await copyFile(
          path.join(output, name),
          path.join(root, "apps/www/src/assets", name),
        );
      }
    }
    for (const name of ["export-dialog.webp", "subtitle-panel.webp"]) {
      await copyFile(
        path.join(output, name),
        path.join(root, "apps/www/public/docs", name),
      );
    }
  }
  const readmeDirectory = path.join(root, ".github/img");
  await mkdir(readmeDirectory, { recursive: true });
  await copyFile(
    path.join(output, "readme.webp"),
    path.join(readmeDirectory, "screenshot.webp"),
  );
  await copyFile(
    path.join(output, "og.jpg"),
    path.join(root, "apps/www/public/og.jpg"),
  );
}
