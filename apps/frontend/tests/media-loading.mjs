import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";
import { build, preview } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), "cliparr-media-loading-"));
const diagnostics = path.resolve(root, "../../build/browser-export/loading");
const features = {
  ac3: "/node_modules/@mediabunny/ac3/",
  aac: "/node_modules/@mediabunny/aac-encoder/",
  mp3: "/node_modules/@mediabunny/mp3-encoder/",
  flac: "/node_modules/@mediabunny/flac-encoder/",
  gif: "/node_modules/@techsquidtv/gifenc/",
  audioPlan: "/src/lib/exportAudio.ts",
  export: "/src/lib/exportClip.ts",
};
const optionalFeatures = Object.keys(features);
const reports = {};
const stages = [];
const sessions = [];
const servers = [];
let browser;
let page;

// Observe the actual emitted modules, including shared chunks. Filenames and
// byte counts can change without weakening the capability boundary assertions.
async function buildSite(name, input = "index.html") {
  const chunks = {};
  const outDir = path.join(temporary, name);
  await build({
    root,
    configFile: path.join(root, "vite.config.js"),
    logLevel: "error",
    plugins: [
      {
        name: "media-loading-report",
        generateBundle(_options, bundle) {
          for (const [file, chunk] of Object.entries(bundle)) {
            if (chunk.type !== "chunk") {
              continue;
            }
            const modules = Object.entries(chunk.modules)
              .filter(([, module]) => module.renderedLength > 0)
              .map(([id]) => id.replaceAll("\\", "/"));
            chunks[file] = {
              bytes: Buffer.byteLength(chunk.code),
              gzipBytes: gzipSync(chunk.code).byteLength,
              features: Object.entries(features)
                .filter(([, fragment]) =>
                  modules.some((id) => id.includes(fragment)),
                )
                .map(([feature]) => feature),
            };
          }
        },
      },
    ],
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: { input: path.join(root, input) },
    },
  });
  for (const feature of optionalFeatures) {
    assert.ok(
      Object.values(chunks).some((chunk) => chunk.features.includes(feature)),
      `Missing ${feature} in ${name} build report`,
    );
  }
  const server = await preview({
    configFile: false,
    root,
    logLevel: "error",
    build: { outDir },
    preview: { host: "127.0.0.1", port: 0 },
  });
  servers.push(server);
  const url = server.resolvedUrls?.local[0];
  assert.ok(url);
  reports[name] = chunks;
  return { name, url, outDir, chunks };
}

async function openPage(site, disableNativeEncoder = false) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
  });
  if (disableNativeEncoder) {
    await context.addInitScript(() => {
      Object.defineProperty(globalThis, "AudioEncoder", { value: undefined });
    });
  }
  page = await context.newPage();
  const requests = [];
  const errors = [];
  sessions.push({ build: site.name, requests, errors });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith(".js")) {
      requests.push(url.pathname.slice(1));
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("/api/session")
        ? { session: null }
        : { providers: [] },
    }),
  );
  return { context, requests, errors, site };
}

async function checkStage(session, label, expected) {
  await page.waitForLoadState("networkidle");
  const files = [...new Set(session.requests)];
  const loaded = [
    ...new Set(
      files.flatMap((file) => session.site.chunks[file]?.features ?? []),
    ),
  ].toSorted();
  stages.push({
    label,
    build: session.site.name,
    files,
    loaded,
    gzipBytes: files.reduce(
      (sum, file) => sum + (session.site.chunks[file]?.gzipBytes ?? 0),
      0,
    ),
  });
  assert.deepEqual(session.errors, [], `${label}: browser errors`);
  assert.deepEqual(
    loaded,
    [...expected].toSorted(),
    `${label}: unexpected feature downloads`,
  );
  process.stdout.write(`PASS ${label}\n`);
}

async function openVideo(site, fixture) {
  await page.getByRole("button", { name: "Open Video", exact: true }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.join(site.outDir, "fixtures", fixture));
  await page.waitForFunction(
    () =>
      globalThis.document.querySelector('button[aria-label="Play preview"]')
        ?.disabled === false,
  );
}

async function waitForExport(format) {
  const label = `Export ${format.toUpperCase()}`;
  await page
    .getByRole("dialog")
    .getByRole("button", { name: label, exact: true })
    .waitFor();
  await page.waitForFunction(
    (text) =>
      [...globalThis.document.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === text && !button.disabled,
      ),
    label,
  );
}

async function selectMode(name) {
  await page.getByRole("combobox", { name: "Export mode" }).click();
  await page.getByRole("option", { name, exact: true }).click();
}

try {
  const app = await buildSite("app");
  const harness = await buildSite("harness", "tests/media-loading.html");
  browser = await chromium.launch({
    headless: true,
    channel: process.env.CLIPARR_TEST_BROWSER_CHANNEL || undefined,
  });
  const generation = await browser.newContext({ serviceWorkers: "block" });
  page = await generation.newPage();
  await page.goto(new URL("tests/media-loading.html", harness.url).href);
  const fixtures = await page.evaluate(() =>
    globalThis.createLoadingFixtures(),
  );
  for (const site of [app, harness]) {
    await mkdir(path.join(site.outDir, "fixtures"), { recursive: true });
    for (const fixture of fixtures) {
      await writeFile(
        path.join(site.outDir, "fixtures", fixture.name),
        Buffer.from(fixture.bytes),
      );
    }
  }
  await generation.close();

  for (const disableNativeEncoder of [false, true]) {
    const session = await openPage(app, disableNativeEncoder);
    await page.goto(app.url);
    await page
      .getByRole("button", { name: "Open Video", exact: true })
      .waitFor();
    await checkStage(
      session,
      `connection (native encoder ${!disableNativeEncoder})`,
      [],
    );
    await openVideo(app, "aac.mp4");
    await checkStage(
      session,
      `AAC preview (native encoder ${!disableNativeEncoder})`,
      [],
    );
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await waitForExport("mp4");
    await checkStage(session, "MP4 export setup", ["audioPlan", "aac"]);
    await selectMode("Audio");
    await waitForExport("mp3");
    await checkStage(session, "MP3 export setup", ["audioPlan", "aac", "mp3"]);
    await page.getByRole("combobox").filter({ hasText: /^MP3/ }).click();
    await page.getByRole("option", { name: /^FLAC/ }).click();
    await waitForExport("flac");
    await checkStage(session, "FLAC export setup", [
      "audioPlan",
      "aac",
      "mp3",
      "flac",
    ]);
    await selectMode("GIF");
    await waitForExport("gif");
    await checkStage(session, "GIF setup before encoding", [
      "audioPlan",
      "aac",
      "mp3",
      "flac",
    ]);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export GIF", exact: true }).click();
    const downloaded = await download;
    assert.equal(await downloaded.failure(), null);
    await checkStage(session, "GIF export", [
      "audioPlan",
      "aac",
      "mp3",
      "flac",
      "gif",
      "export",
    ]);
    await session.context.close();
  }

  for (const fixture of ["ac3.mp4", "eac3.mp4", "aac-ac3.mp4"]) {
    const session = await openPage(app);
    await page.goto(app.url);
    await openVideo(app, fixture);
    await checkStage(
      session,
      `${fixture} selected preview track`,
      fixture === "aac-ac3.mp4" ? [] : ["ac3"],
    );
    await page
      .getByRole("button", { name: "Play preview", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Pause preview", exact: true })
      .waitFor();
    await session.context.close();
  }

  // Close and replace the source while the export helper download is suspended.
  // Resolving the import must not start encoder registration for the stale effect.
  const cancelled = await openPage(app);
  const helperFiles = Object.entries(app.chunks).filter(([, chunk]) =>
    chunk.features.includes("audioPlan"),
  );
  assert.equal(helperFiles.length, 1);
  const held = Promise.withResolvers();
  const helperUrl = new URL(helperFiles[0][0], app.url).href;
  await page.route(helperUrl, async (route) => {
    await held.promise;
    await route.continue();
  });
  try {
    await page.goto(app.url);
    await openVideo(app, "aac.mp4");
    const requested = page.waitForRequest(helperUrl);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await requested;
    await page
      .getByRole("button", { name: "Close export dialog", exact: true })
      .click();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await openVideo(app, "aac-ac3.mp4");
    held.resolve();
    await checkStage(
      cancelled,
      "cancelled export setup after replacing source",
      ["audioPlan"],
    );
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await waitForExport("mp4");
    await checkStage(cancelled, "export setup retry on replacement source", [
      "audioPlan",
      "aac",
    ]);
    for (const feature of ["audioPlan", "aac"]) {
      const matchingRequests = cancelled.requests.filter((file) =>
        app.chunks[file]?.features.includes(feature),
      );
      assert.equal(
        matchingRequests.length,
        1,
        `${feature} downloaded more than once`,
      );
    }
  } finally {
    held.resolve();
  }
  await cancelled.context.close();

  for (const format of ["mp4", "gif", "m4a"]) {
    const session = await openPage(harness, true);
    await page.goto(new URL("tests/media-loading.html", harness.url).href);
    await checkStage(session, `converter before ${format} export`, []);
    const result = await page.evaluate(
      (format) =>
        globalThis.runLoadingExport({
          fixture: "ac3.mp4",
          format,
          mode: format === "m4a" ? "audio-only" : "video-only",
        }),
      format,
    );
    assert.ok(result.size > 0);
    await checkStage(session, `direct ${format} export of AC3 source`, [
      "audioPlan",
      "export",
      ...(format === "gif" ? ["gif"] : []),
      ...(format === "m4a" ? ["ac3", "aac"] : []),
    ]);
    await session.context.close();
  }
} catch (error) {
  await mkdir(diagnostics, { recursive: true });
  await writeFile(
    path.join(diagnostics, "failure.log"),
    String(error.stack ?? error),
  );
  await page
    ?.screenshot({
      path: path.join(diagnostics, "failure.png"),
      fullPage: true,
    })
    .catch(() => {});
  throw error;
} finally {
  await mkdir(diagnostics, { recursive: true });
  await writeFile(
    path.join(diagnostics, "requests.json"),
    JSON.stringify({ sessions, stages }, null, 2),
  );
  await writeFile(
    path.join(diagnostics, "chunks.json"),
    JSON.stringify(reports, null, 2),
  );
  await browser?.close();
  for (const server of servers) {
    await server.close();
  }
  await rm(temporary, { recursive: true, force: true });
}
