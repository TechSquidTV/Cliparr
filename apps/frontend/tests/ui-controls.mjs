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
        const fontSize = features.getByRole("slider", {
          name: "Size",
          exact: true,
        });
        await fontSize.focus();
        await page.keyboard.press("End");
        assert.equal(await fontSize.getAttribute("aria-valuetext"), "150px");
        await features
          .getByRole("button", { name: "Delete subtitle", exact: true })
          .click();
        await features.getByText("Subtitle deleted", { exact: true }).waitFor();
      }
      await page.close();
    }
  }
  process.stdout.write(
    "Shared controls pass in both production stylesheets and motion preferences.\n",
  );
} finally {
  await browser?.close();
  await server?.close();
  await rm(outDir, { recursive: true, force: true });
}
