import { randomBytes } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildScenes } from "#/scenes.ts";
import { run } from "#/process.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const { values } = parseArgs({
  options: {
    "media-dir": { type: "string" },
    hero: { type: "string", default: "hero.mkv" },
    mobile: { type: "string", default: "mobile.mkv" },
    "hero-seconds": { type: "string" },
    "mobile-seconds": { type: "string" },
    "hero-subtitle": { type: "string" },
    "mobile-subtitle": { type: "string" },
    write: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

async function main() {
  if (values.help) {
    process.stdout.write(
      `Usage: pnpm assets:capture --media-dir /path/to/media [options]\n\n  --hero <relative-file>       Default hero.mkv\n  --mobile <relative-file>     Default mobile.mkv\n  --hero-seconds <seconds>     Recording duration; default 82/30\n  --mobile-seconds <seconds>   Recording duration; default 3\n  --hero-subtitle <track-key>  Override the preferred text subtitle track\n  --mobile-subtitle <track-key>\n  --write                     Replace all six www assets after validation\n\nSelections remain hero 496.07–499.01 and mobile 1402–1412 seconds.\n`,
    );
    return;
  }
  if (!values["media-dir"]) {
    throw new Error(
      "Provide --media-dir containing the two source media assets and subtitles.",
    );
  }
  const mediaDirectory = await realpath(values["media-dir"]);
  const mediaDirectoryStat = await stat(mediaDirectory);
  if (!mediaDirectoryStat.isDirectory()) {
    throw new Error("--media-dir must be a directory.");
  }
  const scenes = buildScenes({
    hero: values.hero,
    mobile: values.mobile,
    ...(values["hero-seconds"] === undefined
      ? {}
      : { heroSeconds: values["hero-seconds"] }),
    ...(values["mobile-seconds"] === undefined
      ? {}
      : { mobileSeconds: values["mobile-seconds"] }),
    ...(values["hero-subtitle"]
      ? { heroSubtitle: values["hero-subtitle"] }
      : {}),
    ...(values["mobile-subtitle"]
      ? { mobileSubtitle: values["mobile-subtitle"] }
      : {}),
  });
  for (const scene of scenes) {
    const file = await realpath(path.resolve(mediaDirectory, scene.mediaPath));
    const relative = path.relative(mediaDirectory, file);
    const sourceStat = await stat(file);
    if (
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      !sourceStat.isFile()
    ) {
      throw new Error(
        `${scene.name}: source must be a file within --media-dir.`,
      );
    }
    scene.mediaPath = relative.split(path.sep).join("/");
  }
  await run("docker", ["info"], { capture: true, timeout: 15_000 });
  const runs = path.join(root, ".asset-capture");
  await mkdir(runs, { recursive: true });
  const output = await mkdtemp(path.join(runs, "run-"));
  await writeFile(
    path.join(output, "plan.json"),
    JSON.stringify({ scenes }, null, 2),
  );
  const environment = {
    ...process.env,
    CAPTURE_MEDIA_DIR: mediaDirectory,
    CAPTURE_OUTPUT_DIR: output,
    CAPTURE_PASSWORD: randomBytes(24).toString("hex"),
    CAPTURE_APP_KEY: randomBytes(32).toString("hex"),
  };
  const compose = [
    "compose",
    "-p",
    `cliparr-capture-${path.basename(output).toLowerCase()}`,
    "-f",
    path.join(root, "docker/compose.capture.yml"),
  ];
  process.stdout.write(`Capture artifacts: ${output}\n`);
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const docker = (arguments_: string[], capture = false, cleanup = false) =>
    run("docker", [...compose, ...arguments_], {
      cwd: root,
      env: environment,
      capture,
      timeout: 1_800_000,
      ...(cleanup ? {} : { signal: abort.signal }),
    });
  try {
    await docker(["build", "capture"]);
    await docker([
      "up",
      "--no-build",
      "--wait",
      "--wait-timeout",
      "180",
      "cliparr",
    ]);
    await docker(["run", "--rm", "--no-deps", "capture"]);
    // The recorder writes this last, only after both complete and validate.
    await readFile(path.join(output, "report.json"), "utf8");
    if (values.write) {
      const readmeAssetsDir = path.join(root, ".github", "img");
      await mkdir(readmeAssetsDir, { recursive: true });
      for (const scene of scenes) {
        for (const extension of ["mp4", "webm"]) {
          const name = `${scene.videoName}.${extension}`;
          await copyFile(
            path.join(output, name),
            path.join(root, "apps/www/public", name),
          );
        }
        const name = `${scene.posterName}.webp`;
        await copyFile(
          path.join(output, name),
          path.join(root, "apps/www/src/assets", name),
        );
        if (scene.name === "hero") {
          await copyFile(
            path.join(output, name),
            path.join(readmeAssetsDir, "screenshot.webp"),
          );
        }
      }
    }
    process.stdout.write(
      `Capture complete: ${path.join(output, "review.html")}\n${values.write ? "Updated all six website assets.\n" : "Website assets unchanged; use --write to replace them.\n"}`,
    );
  } catch (error) {
    const logs = await docker(
      ["logs", "--no-color", "--tail", "100"],
      true,
      true,
    ).catch(() => "Container logs unavailable.");
    await writeFile(path.join(output, "containers.log"), logs);
    throw error;
  } finally {
    try {
      await docker(["down", "--volumes", "--remove-orphans"], false, true);
    } finally {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
    }
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Asset capture failed."}\n`,
  );
  process.exitCode = 1;
}
