import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build, preview } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = await mkdtemp(path.join(tmpdir(), "cliparr-audio-browser-"));
let server;
let browser;
try {
  await build({
    root,
    configFile: path.join(root, "vite.config.js"),
    logLevel: "error",
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: { input: path.join(root, "tests/audio-export.html") },
    },
  });
  server = await preview({
    configFile: false,
    root,
    logLevel: "error",
    build: { outDir },
    preview: { host: "127.0.0.1", port: 0 },
  });
  const url = server.resolvedUrls?.local[0];
  assert.ok(url);
  browser = await chromium.launch({
    headless: true,
    channel: process.env.CLIPARR_TEST_BROWSER_CHANNEL || undefined,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("tests/audio-export.html", url).href);
  await page.waitForFunction(
    () => typeof globalThis.runAudioExportChecks === "function",
  );
  const checks = await page.evaluate(async () => {
    try {
      return await globalThis.runAudioExportChecks();
    } catch (error) {
      throw new Error(`${globalThis.document.title}: ${error.message}`, {
        cause: error,
      });
    }
  });
  assert.deepEqual(errors, []);
  // Extension workers are owned by each conversion and must be released after finalization.
  await page.waitForFunction(
    () => globalThis.document.title === "Audio export checks passed",
  );
  assert.equal(
    page.workers().length,
    0,
    "Encoder workers must be closed after exports",
  );
  process.stdout.write(
    `${checks.map((check) => `PASS ${check}`).join("\n")}\n`,
  );
} finally {
  await browser?.close();
  await server?.close();
  await rm(outDir, { recursive: true, force: true });
}
