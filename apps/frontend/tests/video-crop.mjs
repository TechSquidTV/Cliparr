import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { build, preview } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = await mkdtemp(path.join(tmpdir(), "cliparr-video-crop-"));
const screenshots = path.resolve(root, "../../build/browser-export/crop");
await mkdir(screenshots, { recursive: true });
let server;
let browser;
try {
  await build({
    root,
    logLevel: "error",
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: { input: path.join(root, "tests/video-crop.html") },
    },
  });
  server = await preview({
    root,
    configFile: false,
    logLevel: "error",
    build: { outDir },
    preview: { host: "127.0.0.1", port: 0 },
  });
  const address = server.httpServer.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/tests/video-crop.html`;
  browser = await chromium.launch({
    headless: true,
    channel: process.env.CLIPARR_TEST_BROWSER_CHANNEL || undefined,
  });
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      reducedMotion: "reduce",
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1000 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    const crop = page.getByRole("button", { name: "Crop video", exact: true });
    await crop.waitFor();
    await page.waitForFunction(
      () =>
        globalThis.document.querySelector('button[aria-label="Crop video"]')
          ?.disabled === false,
    );
    const pictureTools = page.getByRole("group", { name: "Picture tools" });
    assert.equal(await pictureTools.getByRole("button").count(), 2);
    if (mobile) {
      const touchTarget = await crop.boundingBox();
      assert.ok(touchTarget.width >= 44 && touchTarget.height >= 44);
    }
    await crop.click();
    await page.locator("cropper-selection").waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Draw crop", exact: true })
        .count(),
      0,
    );
    await page.getByRole("button", { name: "Done", exact: true }).waitFor();
    const originalCanvas = await page
      .locator("[data-editor-picture] > canvas")
      .first()
      .elementHandle();
    const cd = mobile ? await context.newCDPSession(page) : null;
    const drag = async (x, y, tx, ty, steps = 6, cancel = false) => {
      if (cd) {
        await cd.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y, id: 0 }],
        });
        // A second finger is rejected; releasing it must leave the primary drag active.
        await cd.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [
            { x, y, id: 0 },
            { x: x + 10, y: y + 10, id: 1 },
          ],
        });
        await cd.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [{ x: x + 10, y: y + 10, id: 1 }],
        });
        for (let index = 1; index <= steps; index++) {
          await cd.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [
              {
                x: x + ((tx - x) * index) / steps,
                y: y + ((ty - y) * index) / steps,
                id: 0,
              },
            ],
          });
        }
        await cd.send("Input.dispatchTouchEvent", {
          type: cancel ? "touchCancel" : "touchEnd",
          touchPoints: [],
        });
      } else {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(tx, ty, { steps });
        await page.mouse.up();
      }
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            globalThis.requestAnimationFrame(() =>
              globalThis.requestAnimationFrame(resolve),
            );
          }),
      );
    };
    const selection = async () => {
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            globalThis.requestAnimationFrame(() =>
              globalThis.requestAnimationFrame(resolve),
            );
          }),
      );
      return page.locator("cropper-selection").evaluate((selection) => ({
        x: selection.x,
        y: selection.y,
        width: selection.width,
        height: selection.height,
      }));
    };
    for (const [sx, sy, ex, ey] of [
      [0.2, 0.2, 0.65, 0.7],
      [0.2, 0.7, 0.65, 0.2],
      [0.65, 0.2, 0.2, 0.7],
      [0.65, 0.7, 0.2, 0.2],
    ]) {
      await page
        .getByRole("button", { name: "Remove crop", exact: true })
        .click();
      await page.locator("cropper-canvas").scrollIntoViewIfNeeded();
      const b = await page.locator("cropper-canvas").boundingBox();
      await drag(
        b.x + b.width * sx,
        b.y + b.height * sy,
        b.x + b.width * ex,
        b.y + b.height * ey,
      );
      const s = await selection();
      assert.ok(Math.abs(s.x - b.width * Math.min(sx, ex)) < 1, "x anchor");
      assert.ok(Math.abs(s.y - b.height * Math.min(sy, ey)) < 1, "y anchor");
      assert.ok(Math.abs(s.width - b.width * Math.abs(sx - ex)) < 1, "width");
      assert.ok(
        Math.abs(s.height - b.height * Math.abs(sy - ey)) < 1,
        "height",
      );
    }
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    let s = await selection();
    let b = await page.locator("cropper-canvas").boundingBox();
    assert.ok(Math.abs(s.width - b.width) < 1, "one gesture undo");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await page.locator("cropper-canvas").scrollIntoViewIfNeeded();
    b = await page.locator("cropper-canvas").boundingBox();
    const beforeRedraw = await selection();
    // Starting outside the selection replaces it without a separate drawing mode.
    await drag(
      b.x + b.width * 0.9,
      b.y + b.height * 0.9,
      b.x + b.width * 0.1,
      b.y + b.height * 0.1,
    );
    s = await selection();
    assert.ok(Math.abs(s.x - b.width * 0.1) < 1, "replacement x anchor");
    assert.ok(Math.abs(s.y - b.height * 0.1) < 1, "replacement y anchor");
    assert.ok(Math.abs(s.width - b.width * 0.8) < 1, "replacement width");
    assert.ok(Math.abs(s.height - b.height * 0.8) < 1, "replacement height");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    s = await selection();
    for (const key of ["x", "y", "width", "height"]) {
      assert.ok(
        Math.abs(s[key] - beforeRedraw[key]) < 1,
        `replacement undo ${key}`,
      );
    }
    await page.locator("cropper-canvas").scrollIntoViewIfNeeded();
    b = await page.locator("cropper-canvas").boundingBox();
    s = await selection();
    await drag(
      b.x + s.x + s.width / 2,
      b.y + s.y + s.height / 2,
      mobile ? 385 : 1200,
      b.y + s.y + s.height / 2,
      1,
    );
    s = await selection();
    assert.ok(Math.abs(s.x + s.width - b.width) < 1, "clamp to right");
    await page
      .getByRole("combobox", { name: "Aspect ratio", exact: true })
      .click();
    await page.getByRole("option", { name: "1:1", exact: true }).click();
    await page.getByRole("listbox").waitFor({ state: "detached" });
    await page.locator("cropper-canvas").scrollIntoViewIfNeeded();
    b = await page.locator("cropper-canvas").boundingBox();
    const h = await page
      .locator('cropper-handle[action="se-resize"]')
      .boundingBox();
    assert.ok(Math.abs(h.width - 44) < 0.1);
    assert.ok(Math.abs(h.height - 44) < 0.1);
    await drag(h.x + 22, h.y + 22, mobile ? 388 : 1250, b.y + b.height + 20, 1);
    s = await selection();
    assert.ok(Math.abs(s.width - s.height) < 1, "locked square");
    assert.ok(
      s.x + s.width <= b.width + 1 && s.y + s.height <= b.height + 1,
      "square within bounds",
    );
    // An interrupted drag retains its last visible region as a single undo step.
    const beforeCancel = await selection();
    await drag(
      b.x + s.x + s.width / 2,
      b.y + s.y + s.height / 2,
      b.x + s.x + s.width / 2 - 20,
      b.y + s.y + s.height / 2,
      4,
      true,
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    s = await selection();
    assert.ok(Math.abs(s.x - beforeCancel.x) < 1, "interrupted gesture undo");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    // Orientation and layout changes must not move the region or add history.
    const beforeResize = await selection();
    const beforeBounds = await page.locator("cropper-canvas").boundingBox();
    await page.setViewportSize(
      mobile ? { width: 844, height: 390 } : { width: 1280, height: 800 },
    );
    await page.waitForFunction(
      (width) => globalThis.innerWidth === width,
      mobile ? 844 : 1280,
    );
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          globalThis.requestAnimationFrame(() =>
            globalThis.requestAnimationFrame(resolve),
          );
        }),
    );
    const afterResize = await selection();
    const afterBounds = await page.locator("cropper-canvas").boundingBox();
    for (const key of ["x", "width"]) {
      assert.ok(
        Math.abs(
          beforeResize[key] / beforeBounds.width -
            afterResize[key] / afterBounds.width,
        ) < 0.001,
      );
    }
    for (const key of ["y", "height"]) {
      assert.ok(
        Math.abs(
          beforeResize[key] / beforeBounds.height -
            afterResize[key] / afterBounds.height,
        ) < 0.001,
      );
    }
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    );
    await page
      .getByRole("button", { name: "Remove crop", exact: true })
      .click();
    // Numeric edits and keyboard nudges use source pixels, including on phones.
    for (const [name, value] of [
      ["Width", "240"],
      ["Height", "180"],
      ["X position", "100"],
      ["Y position", "90"],
    ]) {
      const field = page.getByRole("spinbutton", { name, exact: true });
      await field.fill(value);
      await field.press("Enter");
    }
    s = await selection();
    b = await page.locator("cropper-canvas").boundingBox();
    assert.ok(Math.abs(s.x / b.width - 100 / 960) < 0.001);
    assert.ok(Math.abs(s.width / b.width - 240 / 960) < 0.001);
    await page.getByRole("button", { name: "Center", exact: true }).click();
    const selectedRegion = page.getByRole("group", { name: /^Crop selection/ });
    await selectedRegion.press("ArrowRight");
    s = await selection();
    assert.ok(
      Math.abs(s.x / b.width - 361 / 960) < 0.001,
      "keyboard source-pixel nudge",
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    if (cd) {
      await page.locator("cropper-canvas").scrollIntoViewIfNeeded();
      const scrollBefore = await page
        .locator("main")
        .evaluate((main) => main.scrollTop);
      await cd.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: 20, y: 650, id: 0 }],
      });
      for (let offset = 25; offset <= 150; offset += 25) {
        await cd.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: 20, y: 650 - offset, id: 0 }],
        });
      }
      await cd.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await page.waitForFunction(
        (before) =>
          globalThis.document.querySelector("main").scrollTop > before,
        scrollBefore,
      );
    }
    await page
      .getByRole("button", { name: "Remove crop", exact: true })
      .click();
    // Take a portrait screenshot after the menu finishes closing.
    await page
      .getByRole("combobox", { name: "Aspect ratio", exact: true })
      .click();
    await page.getByRole("option", { name: "9:16", exact: true }).click();
    await page.getByRole("listbox").waitFor({ state: "detached" });
    await page.locator("cropper-canvas").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(screenshots, `${mobile ? "mobile" : "desktop"}-crop.png`),
    });
    if (!mobile) {
      const aside = page.locator("aside");
      assert.equal(await aside.getByRole("tab").count(), 0);
      await aside
        .getByRole("button", { name: "Subtitles", exact: true })
        .click();
      assert.equal(
        await aside
          .getByRole("button", { name: "Crop", exact: true })
          .getAttribute("aria-expanded"),
        "false",
      );
      const cropHeader = await aside
        .getByRole("button", { name: "Crop", exact: true })
        .boundingBox();
      assert.ok(
        cropHeader.y + cropHeader.height <= 1000,
        "collapsed header stays visible",
      );
      await page.screenshot({
        path: path.join(screenshots, "desktop-subtitles.png"),
      });
      await crop.click();
    }
    const beforeDone = await selection();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.locator("cropper-selection").waitFor({ state: "detached" });
    assert.equal(await crop.getAttribute("aria-pressed"), "false");
    await crop.click();
    await page.locator("cropper-selection").waitFor();
    const afterDone = await selection();
    for (const key of ["x", "y", "width", "height"]) {
      assert.ok(
        Math.abs(beforeDone[key] - afterDone[key]) < 1,
        `Done keeps ${key}`,
      );
    }
    // The tool button also finishes editing without removing the crop.
    await crop.click();
    await page.locator("cropper-selection").waitFor({ state: "detached" });
    assert.equal(
      await originalCanvas.evaluate(
        (element) =>
          element ===
          globalThis.document.querySelector("[data-editor-picture] > canvas"),
      ),
      true,
      "canvas retained",
    );
    await page.waitForFunction(
      () => globalThis.document.querySelector("main").scrollTop === 0,
    );
    await page.screenshot({
      path: path.join(
        screenshots,
        `${mobile ? "mobile" : "desktop"}-preview.png`,
      ),
    });
    if (!mobile) {
      for (const [button, filename] of [
        ["Export", "export-dialog"],
        ["Export current preview frame", "framegrab-dialog"],
      ]) {
        await page.getByRole("button", { name: button, exact: true }).click();
        await page.getByRole("dialog").waitFor();
        await page.screenshot({
          path: path.join(screenshots, `${filename}.png`),
        });
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "detached" });
      }
      const checks = await page.evaluate(() =>
        globalThis.runVideoCropExportChecks(),
      );
      process.stdout.write(`${checks.join("\n")}\n`);
    }
    // Reload the actual editor and verify its saved region and ratio.
    await crop.click();
    const saved = await selection();
    await page.waitForFunction(() => {
      const drafts = JSON.parse(
        globalThis.localStorage.getItem("cliparr.editor.drafts.v2") || "[]",
      );
      return drafts.some((draft) => draft.crop?.aspectRatio === 9 / 16);
    });
    await page.reload();
    await page.waitForFunction(
      () =>
        globalThis.document.querySelector('button[aria-label="Crop video"]')
          ?.disabled === false,
    );
    await crop.click();
    await page.locator("cropper-selection").waitFor();
    const restored = await selection();
    for (const key of ["x", "y", "width", "height"]) {
      assert.ok(
        Math.abs(saved[key] - restored[key]) < 1,
        `draft restores ${key}: ${JSON.stringify({ saved, restored })}`,
      );
    }
    assert.equal(
      await page
        .getByRole("combobox", { name: "Aspect ratio", exact: true })
        .textContent(),
      "9:16",
    );
    assert.deepEqual(errors, []);
    process.stdout.write(
      `Crop interaction checks passed (${mobile ? "touch" : "mouse"}).\n`,
    );
    await context.close();
  }
} finally {
  await browser?.close();
  await server?.close();
  await rm(outDir, { recursive: true, force: true });
}
