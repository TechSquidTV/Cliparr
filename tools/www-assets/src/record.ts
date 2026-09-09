/* global window, document, requestAnimationFrame */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { chromium, type Page } from "playwright";
import type { AssetCaptureState } from "@cliparr/shared/asset-capture";
import type { CurrentlyPlayingResponse } from "@cliparr/shared/providers";
import {
  captureUsername,
  jellyfinUrl,
  startJellyfinScene,
} from "#/jellyfin.ts";
import { encodeScene } from "#/encode.ts";
import { waitUntil } from "#/process.ts";
import type { CapturePlan, CaptureScene } from "#/scenes.ts";

const output = "/output";
const cliparrUrl = "http://127.0.0.1:7171";

async function inspect(page: Page) {
  return page.evaluate(() => window.cliparrAssetCapture?.inspect());
}

async function waitForEditor(
  page: Page,
  description: string,
  ready: (state: AssetCaptureState) => boolean,
) {
  let lastState: AssetCaptureState | undefined;
  try {
    return await waitUntil(description, async () => {
      const state = await inspect(page);
      lastState = state;
      if (state?.error) {
        throw new Error(state.error);
      }
      return state && ready(state) ? state : undefined;
    });
  } catch (error) {
    throw new Error(
      `${description}: ${error instanceof Error ? error.message : "failed"}; state=${JSON.stringify(lastState)}`,
      { cause: error },
    );
  }
}

async function prepareScene(page: Page, scene: CaptureScene) {
  await waitForEditor(
    page,
    "editor media metadata",
    (state) => state.mediaReady,
  );
  await page.evaluate(
    (selection) => window.cliparrAssetCapture?.configure(selection),
    scene.selection,
  );
  await waitForEditor(
    page,
    "selection, subtitles, and decoded starting frame",
    (state) =>
      state.previewReady &&
      state.subtitlesReady &&
      state.subtitleCueCount > 0 &&
      Math.abs(state.inSeconds - scene.selection.inSeconds) < 0.001 &&
      Math.abs(state.outSeconds - scene.selection.outSeconds) < 0.001 &&
      state.renderedSeconds !== null &&
      Math.abs(state.renderedSeconds - scene.selection.inSeconds) <=
        state.frameStepSeconds * 1.5,
  );
  await page.evaluate(async () => {
    window.cliparrAssetCapture?.fitSelection();
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  });
}

async function captureScene(page: Page, scene: CaptureScene) {
  await prepareScene(page, scene);
  // Warm decoder/audio activation before resetting to the exact in point.
  await page.evaluate(() => window.cliparrAssetCapture?.play());
  await waitForEditor(
    page,
    "warm playback",
    (state) =>
      state.playing &&
      state.renderedSeconds !== null &&
      state.renderedSeconds > scene.selection.inSeconds + 0.1,
  );
  await prepareScene(page, scene);
  await page.screenshot({
    path: path.join(output, `${scene.name}-prepared.png`),
  });
  const frameTimes: number[] = [];
  await page.screencast.start({
    path: path.join(output, `${scene.name}-raw.webm`),
    size: scene.viewport,
    quality: 100,
    onFrame: ({ timestamp }) => {
      frameTimes.push(timestamp);
      return Promise.resolve();
    },
  });
  const samples: AssetCaptureState[] = [];
  let started: number;
  try {
    await waitUntil("first screencast frame", async () => frameTimes[0]);
    started = await page.evaluate(async () => {
      const timestamp = Date.now();
      await window.cliparrAssetCapture?.play();
      return timestamp;
    });
    const deadline = started + scene.recordingSeconds * 1000;
    while (Date.now() < deadline) {
      const state = await inspect(page);
      if (!state || state.error || !state.subtitlesReady) {
        throw new Error(
          `${scene.name}: playback became unavailable: ${state?.error ?? "capture bridge/subtitles missing"}`,
        );
      }
      samples.push(state);
      await setTimeout(50);
    }
    // Keep enough trailing frames for 30fps normalization without padding a short capture.
    await setTimeout(100);
  } finally {
    await page.screencast.stop();
    await page.evaluate(() => window.cliparrAssetCapture?.pause());
  }
  const firstFrame = frameTimes[0];
  if (firstFrame === undefined || frameTimes.length < 3) {
    throw new Error(`${scene.name}: no usable screencast frames.`);
  }
  const rendered = samples.flatMap((state) =>
    state.renderedSeconds === null ? [] : [state.renderedSeconds],
  );
  const lastRendered = Math.max(...rendered);
  if (
    !samples.some((state) => state.playing) ||
    lastRendered < scene.selection.inSeconds + scene.recordingSeconds - 0.35
  ) {
    throw new Error(
      `${scene.name}: decoded playback did not advance through the recording window.`,
    );
  }
  const gaps = frameTimes
    .slice(1)
    .map((timestamp, index) => timestamp - (frameTimes[index] ?? timestamp));
  const maxFrameGapMs = Math.max(...gaps);
  if (maxFrameGapMs > 500) {
    throw new Error(`${scene.name}: recording stalled for ${maxFrameGapMs}ms.`);
  }
  const startOffsetSeconds = Math.max(0, (started - firstFrame) / 1000);
  await writeFile(
    path.join(output, `${scene.name}-playback.json`),
    JSON.stringify({ samples, startOffsetSeconds, maxFrameGapMs }, null, 2),
  );
  return encodeScene(scene, output, startOffsetSeconds);
}

async function main() {
  const password = process.env.CAPTURE_PASSWORD;
  if (!password) {
    throw new Error("CAPTURE_PASSWORD is required.");
  }
  const plan = JSON.parse(
    await readFile(path.join(output, "plan.json"), "utf8"),
  ) as CapturePlan;
  const browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const results = [];
  try {
    for (const scene of plan.scenes) {
      process.stdout.write(`Preparing ${scene.name} capture.\n`);
      const playback = await startJellyfinScene(scene, password);
      const context = await browser.newContext({
        viewport: scene.viewport,
        screen: scene.viewport,
        deviceScaleFactor: 1,
        isMobile: scene.name === "mobile",
        hasTouch: scene.name === "mobile",
        colorScheme: "dark",
        locale: "en-US",
        timezoneId: "UTC",
        reducedMotion: "no-preference",
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      try {
        const response = await context.request.post(
          `${cliparrUrl}/api/providers/jellyfin/auth/login`,
          {
            data: {
              serverUrl: jellyfinUrl,
              username: captureUsername,
              password,
            },
          },
        );
        if (!response.ok()) {
          throw new Error(`Cliparr login failed: HTTP ${response.status()}.`);
        }
        const item = await waitUntil(
          "Cliparr active playback session",
          async () => {
            playback.check();
            const response = await context.request.get(
              `${cliparrUrl}/api/media/currently-playing`,
            );
            if (!response.ok()) {
              throw new Error(
                `Cliparr playback lookup failed: HTTP ${response.status()}.`,
              );
            }
            const body = (await response.json()) as CurrentlyPlayingResponse;
            return body.viewers
              .flatMap((viewer) => viewer.items)
              .find((item) => item.playerTitle === playback.playerTitle);
          },
        );
        await page.goto(`${cliparrUrl}/edit/${encodeURIComponent(item.id)}`);
        await page.addStyleTag({
          content: `
          *, *::before, *::after { cursor: none !important; }
          button[aria-label="Play playback"], button[aria-label="Pause playback"] {
            visibility: hidden !important;
          }
        `,
        });
        results.push(await captureScene(page, scene));
        playback.check();
        if (pageErrors.length > 0) {
          throw new Error(pageErrors.join("\n"));
        }
      } catch (error) {
        await page
          .screenshot({ path: path.join(output, `${scene.name}-failure.png`) })
          .catch(() => {});
        await writeFile(
          path.join(output, `${scene.name}-failure.json`),
          JSON.stringify(
            {
              state: await inspect(page).catch(() => null),
              pageErrors,
            },
            null,
            2,
          ),
        );
        throw error;
      } finally {
        try {
          await context.close();
        } finally {
          await playback.stop();
        }
      }
    }
    await writeFile(
      path.join(output, "review.html"),
      `<!doctype html><html lang="en"><meta charset="utf-8"><title>Cliparr asset capture</title><style>body{background:#111;color:#eee;font:16px system-ui;margin:32px}section{margin:32px 0}video,img{max-width:100%;height:auto}p{max-width:80ch}</style><h1>Cliparr asset capture</h1><p>Compare each poster with its video, check subtitle rendering and the loop boundary. See report.json for sizes and selected ranges.</p>${plan.scenes.map((scene) => `<section><h2>${scene.name}</h2><p>Selection ${scene.selection.inSeconds}–${scene.selection.outSeconds}s; recording ${scene.recordingSeconds.toFixed(3)}s</p><video controls muted loop playsinline width="${scene.viewport.width}" height="${scene.viewport.height}" poster="${scene.posterName}.webp"><source src="${scene.videoName}.webm" type="video/webm"><source src="${scene.videoName}.mp4" type="video/mp4"></video><details><summary>Poster</summary><img src="${scene.posterName}.webp" width="${scene.viewport.width}" height="${scene.viewport.height}" alt="${scene.name} capture poster"></details></section>`).join("")}</html>`,
    );
    await writeFile(
      path.join(output, "report.json"),
      JSON.stringify({ browser: browser.version(), results }, null, 2),
    );
    for (const result of results) {
      for (const file of result.files) {
        process.stdout.write(
          `${file.name}: ${file.bytes} bytes${file.overTarget ? " (above target; review quality/size)" : ""}\n`,
        );
      }
    }
  } finally {
    await browser.close();
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Capture failed."}\n`,
  );
  process.exitCode = 1;
}
