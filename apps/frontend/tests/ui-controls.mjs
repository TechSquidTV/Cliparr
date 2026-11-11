import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { build, preview } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = await mkdtemp(path.join(tmpdir(), "cliparr-ui-controls-"));
let server;
let browser;
try {
  await build({
    root,
    logLevel: "error",
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          app: path.join(root, "tests/ui-controls.html"),
          www: path.join(root, "tests/ui-controls-www.html"),
        },
      },
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
  browser = await chromium.launch({
    headless: true,
    channel: process.env.CLIPARR_TEST_BROWSER_CHANNEL || undefined,
  });
  for (const site of ["ui-controls", "ui-controls-www"]) {
    for (const reducedMotion of ["reduce", "no-preference"]) {
      const page = await browser.newPage({
        reducedMotion,
        viewport: {
          width: reducedMotion === "reduce" ? 390 : 1280,
          height: 900,
        },
      });
      await page.goto(`http://127.0.0.1:${address.port}/tests/${site}.html`);
      if (site === "ui-controls") {
        const sidebar = page.getByTestId("sidebar-accordion");
        const crop = sidebar.getByRole("button", { name: "Crop", exact: true });
        const samples = await crop.evaluate(async (button) => {
          const heights = [];
          button.click();
          const start = performance.now();
          while (performance.now() - start < 350) {
            heights.push(button.getBoundingClientRect().top);
            await new Promise(globalThis.requestAnimationFrame);
          }
          return heights;
        });
        const first = samples[0];
        const last = samples.at(-1);
        assert.ok(first - last > 200, "opening crop reallocates sidebar space");
        if (reducedMotion === "no-preference") {
          assert.ok(
            samples.filter((top) => top < first - 5 && top > last + 5).length >=
              3,
            "sidebar passes through intermediate positions during reveal",
          );
        }
        await crop.click();
        await sidebar
          .getByRole("button", { name: "Subtitles", exact: true })
          .click();
      }
      const trigger = page.getByRole("button", { name: "Open controls" });
      await trigger.click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      if (reducedMotion === "reduce") {
        const transform = await dialog.evaluate(
          (element) => globalThis.getComputedStyle(element).transform,
        );
        assert.ok(
          transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)",
        );
      }
      const slider = page.getByRole("slider", { name: "Subtitle size" });
      assert.equal(await slider.getAttribute("aria-valuetext"), "24px");
      await slider.focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(await slider.getAttribute("aria-valuetext"), "25px");
      for (const name of ["Standard tabs", "Spring tabs"]) {
        const tabs = page.getByRole("tablist", { name });
        await tabs.getByRole("tab", { name: "First" }).focus();
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("Enter");
        await tabs
          .locator('[role="tab"][aria-selected="true"]')
          .filter({ hasText: "Second" })
          .waitFor();
        assert.equal(
          await tabs
            .getByRole("tab", { name: "Second" })
            .getAttribute("aria-selected"),
          "true",
        );
      }
      if (reducedMotion === "reduce") {
        const transitionProperty = await page
          .locator('[data-slot="tabs-indicator"]')
          .first()
          .evaluate(
            (element) =>
              globalThis.getComputedStyle(element).transitionProperty,
          );
        assert.equal(transitionProperty, "none");
      }
      const select = page.getByRole("combobox", { name: "Output type" });
      const radius = await select.evaluate(
        (element) => globalThis.getComputedStyle(element).borderRadius,
      );
      assert.equal(radius, site === "ui-controls" ? "2px" : "6px");
      await select.click();
      const popup = page.getByRole("listbox");
      await popup.waitFor();
      assert.equal(
        await page
          .locator(".cliparr-select-content")
          .evaluate(
            (element) => globalThis.getComputedStyle(element).animationName,
          ),
        reducedMotion === "reduce" ? "select-fade-in" : "select-unfold",
      );
      await page.getByRole("option", { name: "Audio", exact: true }).click();
      await page.getByRole("switch", { name: "Lock dialog" }).click();
      const navigationTrigger = page.getByRole("button", {
        name: "Request navigation",
      });
      await navigationTrigger.click();
      const confirmation = page.getByRole("dialog", {
        name: "Leave during export?",
      });
      await confirmation.waitFor();
      await confirmation.getByRole("button", { name: "Stay" }).click();
      await confirmation.waitFor({ state: "detached" });
      assert.equal(
        await navigationTrigger.evaluate(
          (element) => element === globalThis.document.activeElement,
        ),
        true,
      );
      assert.equal(await dialog.count(), 1);
      await page.keyboard.press("Escape");
      assert.equal(await dialog.count(), 1);
      await page.getByRole("switch", { name: "Lock dialog" }).click();
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      assert.equal(
        await trigger.evaluate(
          (element) => element === globalThis.document.activeElement,
        ),
        true,
      );
      await trigger.click();
      await dialog.waitFor();
      await page.mouse.click(2, 2);
      await dialog.waitFor({ state: "detached" });
      assert.equal(
        await trigger.evaluate(
          (element) => element === globalThis.document.activeElement,
        ),
        true,
      );
      if (site === "ui-controls") {
        const features = page.getByRole("region", { name: "Feature controls" });
        const mobile = reducedMotion === "reduce";
        assert.equal(await features.getByRole("tab").count(), mobile ? 3 : 0);
        if (mobile) {
          const menu = features.getByRole("button", {
            name: "Open dashboard menu",
          });
          await menu.click();
          const popup = page.getByRole("dialog", { name: "Cliparr Menu" });
          await popup.waitFor();
          await page.setViewportSize({ width: 844, height: 390 });
          await page
            .locator('[data-slot="drawer-overlay"]')
            .waitFor({ state: "detached" });
          await features.getByLabel("Display Name").click();
          await page.setViewportSize({ width: 390, height: 900 });
          assert.equal(await menu.getAttribute("aria-expanded"), "false");
        }
        await features.getByLabel("Display Name").fill("Renamed server");
        await features.getByRole("button", { name: "Save Changes" }).click();
        await features.getByText("Source saved", { exact: true }).waitFor();
        await features
          .getByRole("switch", { name: "Disable Renamed server" })
          .click();
        await features
          .getByRole("switch", { name: "Enable Renamed server" })
          .waitFor();
        await features
          .getByRole("button", { name: "Refresh", exact: true })
          .click();
        await features
          .getByText("Source refresh requested", { exact: true })
          .waitFor();
        await features
          .getByRole("button", { name: "Remove", exact: true })
          .click();
        await features
          .getByText("Source removal requested", { exact: true })
          .waitFor();
        await features
          .getByRole("textbox", { name: "Subtitle text" })
          .fill("Edited subtitle");
        await features
          .getByRole("button", { name: "Seek to selected subtitle" })
          .click();
        await features
          .getByText("Subtitle seek requested", { exact: true })
          .waitFor();
        if (mobile) {
          await features
            .getByRole("tab", { name: "Timing", exact: true })
            .click();
        }
        await features
          .getByRole("button", { name: /^Edit subtitle cue in point:/ })
          .click();
        await features
          .getByRole("textbox", { name: "Edit subtitle cue in point" })
          .fill("2");
        await page.keyboard.press("Enter");
        await features
          .getByText("Subtitle in point changed", { exact: true })
          .waitFor();
        if (mobile) {
          await features
            .getByRole("tab", { name: "Style", exact: true })
            .click();
        }
        const fontSize = features.getByRole("slider", {
          name: "Size",
          exact: true,
        });
        await fontSize.focus();
        await page.keyboard.press("End");
        assert.equal(await fontSize.getAttribute("aria-valuetext"), "150px");
        if (mobile) {
          await features
            .getByRole("tab", { name: "Text", exact: true })
            .click();
        }
        await features
          .getByRole("button", { name: "Delete subtitle", exact: true })
          .click();
        await features.getByText("Subtitle deleted", { exact: true }).waitFor();
        await features
          .getByRole("button", { name: "Subtitle options", exact: true })
          .click();
        const unavailable = page.getByRole("group", {
          name: "Cannot be imported",
        });
        for (const reason of [
          "Image-based subtitles cannot be imported. Only text tracks are supported.",
          "Select this embedded subtitle in Plex first.",
        ]) {
          const item = unavailable.getByRole("menuitem").filter({
            hasText: reason,
          });
          assert.equal(await item.getAttribute("aria-disabled"), "true");
        }
        if (process.env.CLIPARR_UI_SCREENSHOT_DIR) {
          await page.screenshot({
            path: path.join(
              process.env.CLIPARR_UI_SCREENSHOT_DIR,
              `subtitle-menu-${reducedMotion}.png`,
            ),
          });
        }
        await page
          .getByRole("group", { name: "Import subtitle track" })
          .getByRole("menuitem", { name: /English/ })
          .click();
        await features
          .getByText("Subtitle import requested", { exact: true })
          .waitFor();
      }
      await page.close();
    }
  }
  const touchPage = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const touch = await touchPage.context().newCDPSession(touchPage);
  for (const hideTrackNames of [false, true]) {
    await touchPage.goto(
      `http://127.0.0.1:${address.port}/tests/ui-controls.html?timeline`,
    );
    if (hideTrackNames) {
      await touchPage
        .getByRole("button", { name: "Toggle timeline track names" })
        .click();
    }
    const thumb = touchPage.getByRole("scrollbar", {
      name: "Timeline viewport",
      exact: true,
    });
    await thumb.scrollIntoViewIfNeeded();
    const box = await thumb.boundingBox();
    assert.ok(box);
    const initialPageScroll = await touchPage.evaluate(
      () => globalThis.scrollY,
    );
    const track = await touchPage
      .locator(".timeline-viewport-scrollbar")
      .boundingBox();
    assert.ok(track);
    const travel = track.width - box.width;
    assert.ok(travel > 30);
    await thumb.evaluate((element) => {
      const { dataset } = element;
      dataset.cancellations = "0";
      element.addEventListener("pointercancel", () => {
        dataset.cancellations = String(Number(dataset.cancellations) + 1);
      });
    });
    const readStart = async () =>
      Number(await thumb.getAttribute("aria-valuenow"));
    const start = await readStart();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 0 }],
    });
    let previous = start;
    let previousDelta = 0;
    // One uninterrupted finger gesture must keep updating beyond the browser's
    // pan threshold, including when reversing back toward its starting point.
    for (const fraction of [0.15, 0.3, 0.5, 0.7, 0.5, 0.3, 0.15]) {
      const delta = fraction * travel;
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + delta, y, id: 0 }],
      });
      // Touch moves may be coalesced until the next animation frame.
      await touchPage.evaluate(
        () =>
          new Promise((resolve) => {
            globalThis.requestAnimationFrame(() =>
              globalThis.requestAnimationFrame(resolve),
            );
          }),
      );
      const current = await readStart();
      assert.ok(
        (current - previous) * (delta - previousDelta) > 0,
        `touch drag must keep updating at ${delta}px`,
      );
      previous = current;
      previousDelta = delta;
      assert.equal(
        await touchPage.evaluate(() => globalThis.scrollY),
        initialPageScroll,
      );
    }
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    assert.equal(await thumb.getAttribute("data-cancellations"), "0");
    assert.ok((await readStart()) > start);
    await thumb.focus();
    const beforeKey = await readStart();
    await touchPage.keyboard.press("ArrowRight");
    assert.ok(
      (await readStart()) > beforeKey,
      "keyboard panning remains available",
    );
    process.stdout.write(
      `Timeline touch drag passes with track names ${hideTrackNames ? "hidden" : "shown"}.\n`,
    );
  }
  await touchPage.close();
  process.stdout.write(
    "Shared controls pass in both production stylesheets and motion preferences.\n",
  );
} finally {
  await browser?.close();
  await server?.close();
  await rm(outDir, { recursive: true, force: true });
}
