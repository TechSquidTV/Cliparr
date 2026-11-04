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
    const scenario = async (name, run) => {
      const label = `${mobile ? "touch" : "mouse"}: ${name}`;
      try {
        const result = await run();
        process.stdout.write(`Passed ${label}\n`);
        return result;
      } catch (error) {
        throw new Error(`Crop scenario failed (${label})`, { cause: error });
      }
    };
    // Scenarios intentionally share one editor session to exercise history,
    // tool transitions, and draft persistence in the same order on both inputs.
    const originalCanvas = await scenario(
      "open crop tool and verify touch layout",
      async () => {
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
        if (mobile) {
          await page.waitForFunction(() => {
            const stage = globalThis.document
              .querySelector("[data-editor-preview-stage]")
              .getBoundingClientRect();
            const picture = globalThis.document
              .querySelector("[data-editor-picture]")
              .getBoundingClientRect();
            return (
              picture.width > 0 &&
              Math.abs(stage.height - picture.height - 50) < 1 &&
              Math.abs(stage.width - picture.width - 50) < 1
            );
          });
        }
        return page
          .locator("[data-editor-picture] > canvas")
          .first()
          .elementHandle();
      },
    );
    const waitForPaint = () =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            globalThis.requestAnimationFrame(() =>
              globalThis.requestAnimationFrame(resolve),
            );
          }),
      );
    const removeCrop = () =>
      page.getByRole("button", { name: "Remove crop", exact: true }).click();
    const chooseRatio = async (name) => {
      await page
        .getByRole("combobox", { name: "Aspect ratio", exact: true })
        .click();
      await page.getByRole("option", { name, exact: true }).click();
      await page.getByRole("listbox").waitFor({ state: "detached" });
    };
    const setCropFields = async (fields) => {
      for (const [name, value] of fields) {
        const field = page.getByRole("spinbutton", { name, exact: true });
        await field.fill(String(value));
        await field.press("Enter");
      }
    };
    const cd = mobile ? await context.newCDPSession(page) : null;
    const drag = async (
      x,
      y,
      tx,
      ty,
      steps = 6,
      cancel = false,
      beforeRelease,
    ) => {
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
        await beforeRelease?.();
        await cd.send("Input.dispatchTouchEvent", {
          type: cancel ? "touchCancel" : "touchEnd",
          touchPoints: [],
        });
      } else {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(tx, ty, { steps });
        await beforeRelease?.();
        await page.mouse.up();
      }
      await waitForPaint();
    };
    const selection = async (coordinateSpace = "pixels", expected) => {
      const deadline = Date.now() + 30_000;
      let previous;
      let region;
      while (Date.now() < deadline) {
        await waitForPaint();
        const snapshot = await page
          .locator("cropper-selection")
          .evaluate((selected) => {
            const bounds = selected.parentElement.getBoundingClientRect();
            return {
              x: selected.x,
              y: selected.y,
              width: selected.width,
              height: selected.height,
              canvasWidth: bounds.width,
              canvasHeight: bounds.height,
            };
          });
        const { canvasWidth, canvasHeight, ...rectangle } = snapshot;
        region = Object.fromEntries(
          Object.entries(rectangle).map(([key, value]) => [
            key,
            coordinateSpace === "normalized"
              ? value /
                (key === "x" || key === "width" ? canvasWidth : canvasHeight)
              : value,
          ]),
        );
        // Reopening crop mode can resize both the preview and the selection.
        // Require both to settle, then compare and return that same snapshot.
        const stable =
          previous &&
          Object.keys(snapshot).every((key) => snapshot[key] === previous[key]);
        const matches =
          !expected ||
          Object.keys(region).every(
            (key) => Math.abs(region[key] - expected[key]) < 0.001,
          );
        if (canvasWidth > 0 && canvasHeight > 0 && stable && matches) {
          return region;
        }
        previous = snapshot;
      }
      assert.fail(
        `Crop geometry did not settle: ${JSON.stringify({ expected, region, previous })}`,
      );
    };
    const waitForSelection = (expected) => selection("normalized", expected);
    const sideHandles = page.locator(
      'cropper-handle:is([action="n-resize"], [action="e-resize"], [action="s-resize"], [action="w-resize"]):visible',
    );
    await scenario("free and locked side handles", async () => {
      for (const locked of [false, true]) {
        for (const direction of ["n", "e", "s", "w"]) {
          await removeCrop();
          if (locked) {
            await chooseRatio("1:1");
          }
          await page.locator("cropper-canvas").scrollIntoViewIfNeeded();
          const before = await selection("normalized");
          const initial = await selection();
          const bounds = await page.locator("cropper-canvas").boundingBox();
          const handle = page.locator(
            `cropper-handle[action="${direction}-resize"]`,
          );
          const target = await handle.boundingBox();
          assert.equal(target.width, 44);
          assert.equal(target.height, 44);
          const horizontal = direction === "e" || direction === "w";
          const sign = direction === "n" || direction === "w" ? 1 : -1;
          await drag(
            target.x + 22,
            target.y + 22,
            target.x + 22 + (horizontal ? sign * 20 : 0),
            target.y + 22 + (horizontal ? 0 : sign * 20),
          );
          const resized = await selection();
          const after = await selection("normalized");
          assert.ok(
            Math.abs(
              resized[horizontal ? "width" : "height"] -
                initial[horizontal ? "width" : "height"] +
                20,
            ) < 1,
            `${direction} edge follows pointer`,
          );
          if (locked) {
            assert.ok(
              Math.abs(resized.width - resized.height) < 1,
              `${direction} ratio stays locked`,
            );
          } else {
            assert.ok(
              Math.abs(
                resized[horizontal ? "height" : "width"] -
                  initial[horizontal ? "height" : "width"],
              ) < 1,
              `${direction} keeps perpendicular size`,
            );
          }
          const fixedEdge = (region) => {
            const edges = {
              n: region.y + region.height,
              s: region.y,
              w: region.x + region.width,
              e: region.x,
            };
            return edges[direction];
          };
          const midpoint = (region) =>
            horizontal
              ? region.y + region.height / 2
              : region.x + region.width / 2;
          assert.ok(
            Math.abs(fixedEdge(resized) - fixedEdge(initial)) < 1,
            `${direction} opposite edge fixed`,
          );
          assert.ok(
            Math.abs(midpoint(resized) - midpoint(initial)) < 1,
            `${direction} midpoint fixed`,
          );
          await page.getByRole("button", { name: "Undo", exact: true }).click();
          await waitForSelection(before);
          await page.getByRole("button", { name: "Redo", exact: true }).click();
          await waitForSelection(after);
          const smaller = await handle.boundingBox();
          const outwardX =
            direction === "w" ? bounds.x - 20 : bounds.x + bounds.width + 20;
          const outwardY =
            direction === "n" ? bounds.y - 20 : bounds.y + bounds.height + 20;
          await drag(
            smaller.x + 22,
            smaller.y + 22,
            horizontal ? outwardX : smaller.x + 22,
            horizontal ? smaller.y + 22 : outwardY,
            1,
          );
          const expanded = await selection();
          assert.ok(expanded.x >= -0.01 && expanded.y >= -0.01);
          assert.ok(expanded.x + expanded.width <= bounds.width + 0.01);
          assert.ok(expanded.y + expanded.height <= bounds.height + 0.01);
          assert.ok(Math.abs(fixedEdge(expanded) - fixedEdge(initial)) < 1);
          assert.ok(Math.abs(midpoint(expanded) - midpoint(initial)) < 1);
          if (locked) {
            assert.ok(Math.abs(expanded.width - expanded.height) < 1);
          }
        }
      }
    });
    if (!mobile) {
      await scenario("temporary Shift ratio at all eight handles", async () => {
        // Shift temporarily locks Free resizing, including when a side or corner
        // hits a boundary. It must not turn the dropdown into a permanent lock.
        const shiftScenarios = [240, 180].flatMap((height) =>
          ["n", "e", "s", "w", "nw", "ne", "sw", "se"].map((direction) => ({
            height,
            direction,
          })),
        );
        for (const { height, direction } of shiftScenarios) {
          await removeCrop();
          await setCropFields([
            ["Width", 240],
            ["Height", height],
            ["X position", 80],
            ["Y position", 60],
          ]);
          const before = await selection("normalized");
          const bounds = await page.locator("cropper-canvas").boundingBox();
          const target = await page
            .locator(`cropper-handle[action="${direction}-resize"]`)
            .boundingBox();
          let endX = target.x + 22;
          let endY = target.y + 22;
          if (direction.includes("w")) {
            endX = bounds.x - 20;
          }
          if (direction.includes("e")) {
            endX = bounds.x + bounds.width + 20;
          }
          if (direction.includes("n")) {
            endY = bounds.y - 20;
          }
          if (direction.includes("s")) {
            endY = bounds.y + bounds.height + 20;
          }
          await page.keyboard.down("Shift");
          try {
            await drag(target.x + 22, target.y + 22, endX, endY);
          } finally {
            await page.keyboard.up("Shift");
          }
          const resized = await selection();
          assert.ok(
            resized.width / bounds.width > before.width + 0.001,
            `${direction} Shift drag expands the crop`,
          );
          assert.ok(
            Math.min(
              resized.x,
              resized.y,
              bounds.width - resized.x - resized.width,
              bounds.height - resized.y - resized.height,
            ) < 1,
            `${direction} Shift drag reaches a boundary`,
          );
          assert.ok(
            Math.abs(resized.width / resized.height - 240 / height) < 0.001,
            `${direction} Shift ratio survives boundary`,
          );
          assert.ok(resized.x >= -0.01 && resized.y >= -0.01);
          assert.ok(resized.x + resized.width <= bounds.width + 0.01);
          assert.ok(resized.y + resized.height <= bounds.height + 0.01);
          assert.equal(
            await page
              .getByRole("combobox", { name: "Aspect ratio", exact: true })
              .textContent(),
            "Free",
          );
          const after = await selection("normalized");
          await page.getByRole("button", { name: "Undo", exact: true }).click();
          await waitForSelection(before);
          await page.getByRole("button", { name: "Redo", exact: true }).click();
          await waitForSelection(after);
        }
        // Releasing Shift restores free sizing on the next drag.
        const east = await page
          .locator('cropper-handle[action="e-resize"]')
          .boundingBox();
        const beforeFreeResize = await selection();
        await drag(east.x + 22, east.y + 22, east.x + 2, east.y + 22);
        const freeResize = await selection();
        assert.ok(Math.abs(freeResize.height - beforeFreeResize.height) < 1);
        assert.ok(Math.abs(freeResize.width - beforeFreeResize.width + 20) < 1);
      });
    }
    await scenario("draw in every direction and undo one gesture", async () => {
      for (const [sx, sy, ex, ey] of [
        [0.2, 0.2, 0.65, 0.7],
        [0.2, 0.7, 0.65, 0.2],
        [0.65, 0.2, 0.2, 0.7],
        [0.65, 0.7, 0.2, 0.2],
      ]) {
        await removeCrop();
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
      const s = await selection();
      const b = await page.locator("cropper-canvas").boundingBox();
      assert.ok(Math.abs(s.width - b.width) < 1, "one gesture undo");
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await page.locator("cropper-canvas").scrollIntoViewIfNeeded();
    });
    await scenario("undo and redo while a pointer is held", async () => {
      const b = await page.locator("cropper-canvas").boundingBox();
      // History commands finish a held gesture before undoing it. Releasing the
      // pointer afterwards must neither add an edit nor clear its redo entry.
      const beforeHistoryDrag = await selection("normalized");
      const s = await selection();
      let duringHistoryDrag;
      await drag(
        b.x + s.x + s.width / 2,
        b.y + s.y + s.height / 2,
        b.x + s.x + s.width / 2 + 12,
        b.y + s.y + s.height / 2,
        6,
        false,
        async () => {
          duringHistoryDrag = await selection("normalized");
          assert.ok(duringHistoryDrag.x > beforeHistoryDrag.x, "drag moved");
          await page.keyboard.press("Control+z");
          await waitForSelection(beforeHistoryDrag);
          const pointerX = b.x + s.x + s.width / 2 + 18;
          const pointerY = b.y + s.y + s.height / 2;
          if (cd) {
            await cd.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ x: pointerX, y: pointerY, id: 0 }],
            });
          } else {
            await page.mouse.move(pointerX, pointerY);
          }
          await waitForSelection(beforeHistoryDrag);
          await page.keyboard.press("Control+Shift+z");
          await waitForSelection(duringHistoryDrag);
          await page.keyboard.press("Control+z");
          await waitForSelection(beforeHistoryDrag);
        },
      );
      await waitForSelection(beforeHistoryDrag);
      const redo = page.getByRole("button", { name: "Redo", exact: true });
      assert.equal(await redo.isEnabled(), true, "release preserves redo");
      await redo.click();
      await waitForSelection(duringHistoryDrag);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await waitForSelection(beforeHistoryDrag);
    });
    await scenario("replace an existing crop and undo", async () => {
      const b = await page.locator("cropper-canvas").boundingBox();
      const beforeRedraw = await selection();
      // Starting outside the selection replaces it without a separate drawing mode.
      await drag(
        b.x + b.width * 0.9,
        b.y + b.height * 0.9,
        b.x + b.width * 0.1,
        b.y + b.height * 0.1,
      );
      let s = await selection();
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
    });
    await scenario("clamp movement and locked corner resizing", async () => {
      await page.locator("cropper-canvas").scrollIntoViewIfNeeded();
      let b = await page.locator("cropper-canvas").boundingBox();
      let s = await selection();
      await drag(
        b.x + s.x + s.width / 2,
        b.y + s.y + s.height / 2,
        mobile ? 385 : 1200,
        b.y + s.y + s.height / 2,
        1,
      );
      s = await selection();
      assert.ok(Math.abs(s.x + s.width - b.width) < 1, "clamp to right");
      await chooseRatio("1:1");
      await page.locator("cropper-canvas").scrollIntoViewIfNeeded();
      b = await page.locator("cropper-canvas").boundingBox();
      const h = await page
        .locator('cropper-handle[action="se-resize"]')
        .boundingBox();
      assert.ok(Math.abs(h.width - 44) < 0.1);
      assert.ok(Math.abs(h.height - 44) < 0.1);
      await drag(
        h.x + 22,
        h.y + 22,
        mobile ? 388 : 1250,
        b.y + b.height + 20,
        1,
      );
      s = await selection();
      assert.ok(Math.abs(s.width - s.height) < 1, "locked square");
      assert.ok(
        s.x + s.width <= b.width + 1 && s.y + s.height <= b.height + 1,
        "square within bounds",
      );
    });
    await scenario("interrupted gesture history", async () => {
      const b = await page.locator("cropper-canvas").boundingBox();
      // An interrupted drag retains its last visible region as a single undo step.
      const beforeCancel = await selection();
      let s = beforeCancel;
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
    });
    await scenario(
      "preserve geometry through layout and orientation changes",
      async () => {
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
        await waitForPaint();
        const afterResize = await selection();
        const afterBounds = await page.locator("cropper-canvas").boundingBox();
        if (mobile) {
          const stage = await page
            .locator("[data-editor-preview-stage]")
            .boundingBox();
          assert.ok(
            stage.height <= 390 * 0.45 + 2,
            "crop stage respects height cap",
          );
        }
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
      },
    );
    await scenario(
      "numeric edits, keyboard nudges, and small touch targets",
      async () => {
        await removeCrop();
        // Numeric edits and keyboard nudges use source pixels, including on phones.
        await setCropFields([
          ["Width", "240"],
          ["Height", "180"],
          ["X position", "100"],
          ["Y position", "90"],
        ]);
        let s = await selection();
        const b = await page.locator("cropper-canvas").boundingBox();
        assert.ok(Math.abs(s.x / b.width - 100 / 960) < 0.001);
        assert.ok(Math.abs(s.width / b.width - 240 / 960) < 0.001);
        if (mobile) {
          assert.equal(
            await sideHandles.count(),
            0,
            "hide overlapping side targets on small crops",
          );
        }
        await page.getByRole("button", { name: "Center", exact: true }).click();
        const selectedRegion = page.getByRole("group", {
          name: /^Crop selection/,
        });
        await selectedRegion.press("ArrowRight");
        s = await selection();
        assert.ok(
          Math.abs(s.x / b.width - 361 / 960) < 0.001,
          "keyboard source-pixel nudge",
        );
        await page.getByRole("button", { name: "Undo", exact: true }).click();
      },
    );
    if (cd) {
      await scenario("scroll outside the crop surface", async () => {
        // A shorter phone needs scrolling even with the compact preview stage.
        await page.setViewportSize({ width: 390, height: 600 });
        await page.locator("cropper-canvas").scrollIntoViewIfNeeded();
        const scrollBefore = await page
          .locator("main")
          .evaluate((main) => main.scrollTop);
        await cd.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: 20, y: 550, id: 0 }],
        });
        for (let offset = 25; offset <= 150; offset += 25) {
          await cd.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: 20, y: 550 - offset, id: 0 }],
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
        await page.setViewportSize({ width: 390, height: 844 });
      });
    }
    await scenario("portrait handles and property panels", async () => {
      await removeCrop();
      // Take a portrait screenshot after the menu finishes closing.
      await chooseRatio("9:16");
      await page.locator("cropper-canvas").scrollIntoViewIfNeeded();
      assert.equal(
        await sideHandles.count(),
        4,
        "side targets return when the crop fits",
      );
      await page.screenshot({
        path: path.join(
          screenshots,
          `${mobile ? "mobile" : "desktop"}-crop.png`,
        ),
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
    });
    await scenario(
      "Done and tool toggle preserve crop and preview canvas",
      async () => {
        const beforeDone = await selection("normalized");
        await page.getByRole("button", { name: "Done", exact: true }).click();
        await page.locator("cropper-selection").waitFor({ state: "detached" });
        assert.equal(await crop.getAttribute("aria-pressed"), "false");
        await crop.click();
        await page.locator("cropper-selection").waitFor();
        await waitForSelection(beforeDone);
        const afterDone = await selection("normalized");
        for (const key of ["x", "y", "width", "height"]) {
          assert.ok(
            Math.abs(beforeDone[key] - afterDone[key]) < 0.001,
            `Done keeps ${key}`,
          );
        }
        // Desktop also supports toggling the tool off. The phone crop view hides
        // the timeline toolbar, so Done remains its exit action.
        await page
          .getByRole("button", {
            name: mobile ? "Done" : "Crop video",
            exact: true,
          })
          .click();
        await page.locator("cropper-selection").waitFor({ state: "detached" });
        assert.equal(
          await originalCanvas.evaluate(
            (element) =>
              element ===
              globalThis.document.querySelector(
                "[data-editor-picture] > canvas",
              ),
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
      },
    );
    if (!mobile) {
      await scenario(
        "collapsed sidebar, export dialogs, and exported pixels",
        async () => {
          await page
            .getByRole("button", {
              name: "Collapse properties sidebar",
              exact: true,
            })
            .click();
          await page.waitForFunction(
            () =>
              globalThis.document.querySelector("aside").getBoundingClientRect()
                .width < 80,
          );
          await page.screenshot({
            path: path.join(screenshots, "desktop-sidebar-collapsed.png"),
          });
          await page
            .getByRole("button", {
              name: "Expand properties sidebar",
              exact: true,
            })
            .click();
          await page.waitForFunction(
            () =>
              globalThis.document.querySelector("aside").getBoundingClientRect()
                .width > 200,
          );
          for (const [button, filename] of [
            ["Export", "export-dialog"],
            ["Export current preview frame", "framegrab-dialog"],
          ]) {
            await page
              .getByRole("button", { name: button, exact: true })
              .click();
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
        },
      );
    }
    await scenario("restore crop and ratio from the saved draft", async () => {
      // Drafts retain source-relative geometry even when adaptive previews resize.
      await crop.click();
      const savedDraft = await page.waitForFunction(() => {
        const drafts = JSON.parse(
          globalThis.localStorage.getItem("cliparr.editor.drafts.v2") || "[]",
        );
        const draft = drafts.find(
          (entry) => entry.sessionId === "crop-browser-fixture",
        );
        return draft?.crop?.aspectRatio === 9 / 16 ? draft.crop : null;
      });
      const saved = await savedDraft.jsonValue();
      await savedDraft.dispose();
      await waitForSelection(saved.region);
      await page.reload();
      await page.waitForFunction(
        () =>
          globalThis.document.querySelector('button[aria-label="Crop video"]')
            ?.disabled === false,
      );
      await crop.click();
      await page.locator("cropper-selection").waitFor();
      await waitForSelection(saved.region);
      const restored = await selection("normalized");
      for (const key of ["x", "y", "width", "height"]) {
        assert.ok(
          Math.abs(saved.region[key] - restored[key]) < 0.001,
          `draft restores ${key}: ${JSON.stringify({ saved, restored })}`,
        );
      }
      assert.equal(
        await page
          .getByRole("combobox", { name: "Aspect ratio", exact: true })
          .textContent(),
        "9:16",
      );
    });
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
