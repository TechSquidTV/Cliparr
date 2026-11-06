import assert from "node:assert/strict";

export async function checkEditorReviewRegressions({ browser, url }) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/delayed-crop-subtitles.vtt", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: { message: "Import failed for review test" },
      }),
    }),
  );
  await page.goto(`${url}?fixture=delayed-subtitles`);
  const importError = page.getByText("Import failed for review test", {
    exact: true,
  });
  await importError.waitFor();
  await page.getByRole("button", { name: "Add subtitle", exact: true }).click();
  const text = page.getByRole("textbox", {
    name: "Subtitle text",
    exact: true,
  });
  await text.fill("   ");
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await undo.focus();
  await page.getByText(/Blank text was not saved/).waitFor();
  assert.ok(
    await importError.isVisible(),
    "Import and text errors remain independently visible",
  );
  const banner = await importError.locator("..").boundingBox();
  const history = await undo.boundingBox();
  assert.ok(
    banner && history && banner.y >= history.y + history.height,
    "Subtitle feedback does not overlay desktop history controls",
  );
  await undo.click();
  const redo = page.getByRole("button", { name: "Redo", exact: true });
  assert.equal(
    await redo.isEnabled(),
    true,
    "Undo remains usable while an error is visible",
  );
  await redo.click();
  await page
    .getByRole("button", { name: "Dismiss subtitle messages", exact: true })
    .click();
  await importError.waitFor({ state: "detached" });
  assert.equal(await page.getByText(/Blank text was not saved/).count(), 0);

  const selectCue = async () => {
    const timeline = await page
      .locator("[data-editor-timeline-viewport]")
      .boundingBox();
    const rail = await page
      .getByRole("button", { name: "Subtitle tools", exact: true })
      .boundingBox();
    assert.ok(timeline && rail);
    await page.mouse.click(timeline.x + 60, rail.y + rail.height / 2);
    // Activation runs on the next animation frame after selection.
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          globalThis.requestAnimationFrame(() =>
            globalThis.requestAnimationFrame(resolve),
          );
        }),
    );
  };
  await selectCue();
  assert.equal(
    await text.inputValue(),
    "New subtitle",
    "Dismissing feedback preserves the cue",
  );
  await page
    .getByRole("button", { name: "Collapse properties sidebar", exact: true })
    .click();
  await selectCue();
  await page.locator(".timeline-clip-interaction-layer").focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await page
      .getByRole("button", { name: "Expand properties sidebar", exact: true })
      .count(),
    1,
    "Desktop cue selection keeps the inspector collapsed",
  );
  await page
    .getByRole("button", { name: "Subtitle tools", exact: true })
    .click();
  await text.waitFor();
  await page.getByRole("button", { name: "Crop video", exact: true }).click();
  await page.locator("cropper-selection").waitFor();
  await selectCue();
  await page.locator(".timeline-clip-interaction-layer").focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await page.locator("main").getAttribute("data-crop-editing"),
    "true",
    "Desktop cue selection preserves crop mode",
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();

  for (const mobileStart of [false, true]) {
    for (const reset of [false, true]) {
      const desktopLauncher = reset ? "Reset draft" : "Shortcuts";
      await page.setViewportSize(
        mobileStart
          ? { width: 402, height: 874 }
          : { width: 1280, height: 900 },
      );
      if (mobileStart) {
        await page
          .getByRole("button", { name: "More editor options", exact: true })
          .click();
      }
      await page
        .getByRole("button", {
          name: desktopLauncher,
          exact: true,
        })
        .click();
      const dialog = page.getByRole("dialog", {
        name: reset ? "Reset draft?" : "Editor shortcuts",
        exact: true,
      });
      await dialog.waitFor();
      const handle = await dialog.elementHandle();
      const close = dialog.getByRole("button", {
        name: reset ? "Cancel" : "Close shortcut help",
        exact: true,
      });
      await close.focus();
      for (const mobile of [!mobileStart, mobileStart, !mobileStart]) {
        await page.setViewportSize(
          mobile ? { width: 402, height: 874 } : { width: 1280, height: 900 },
        );
        await page.waitForFunction(
          (mobile) =>
            Boolean(
              globalThis.document.querySelector(
                '[aria-label="More editor options"]',
              ),
            ) === mobile,
          mobile,
        );
        assert.ok(
          await handle.evaluate((element) => element.isConnected),
          "Responsive changes preserve the dialog host",
        );
        assert.ok(
          await close.evaluate(
            (element) => element === globalThis.document.activeElement,
          ),
          "Responsive changes preserve dialog focus",
        );
      }
      await close.click();
      await dialog.waitFor({ state: "detached" });
      const launcher = page.getByRole("button", {
        name: mobileStart ? desktopLauncher : "More editor options",
        exact: true,
      });
      assert.ok(
        await launcher.evaluate(
          (element) => element === globalThis.document.activeElement,
        ),
        "Closing restores focus to the current layout launcher",
      );
    }
  }
  assert.deepEqual(errors, []);
  await page.close();
  process.stdout.write(
    "Passed review regressions: feedback, desktop selection, responsive dialogs\n",
  );
}
