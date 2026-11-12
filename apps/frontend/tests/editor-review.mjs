import assert from "node:assert/strict";

async function checkPausedSubtitlePreview({ browser, url }) {
  for (const time of [1.05, 1]) {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      reducedMotion: "reduce",
    });
    try {
      await page.goto(`${url}?fixture=subtitle-frame&time=${time}`);
      const add = page.getByRole("button", {
        name: "Add subtitle",
        exact: true,
      });
      await page.waitForFunction(() => {
        const button = [...globalThis.document.querySelectorAll("button")].find(
          (element) => element.textContent === "Add subtitle",
        );
        return button && !button.disabled;
      });
      const overlay = page.locator(
        '[data-editor-picture] canvas[aria-hidden="true"]',
      );
      const readOverlay = () =>
        overlay.evaluateHandle((canvas) =>
          canvas
            .getContext("2d")
            .getImageData(0, 0, canvas.width, canvas.height),
        );
      const waitForOverlay = (expected, matches = true) =>
        page.waitForFunction(
          ({ image, matches }) => {
            const canvas = globalThis.document.querySelector(
              '[data-editor-picture] canvas[aria-hidden="true"]',
            );
            const pixels = canvas
              .getContext("2d")
              .getImageData(0, 0, canvas.width, canvas.height).data;
            // Canvas readback can change rasterization paths and round by one.
            const equal =
              canvas.width === image.width &&
              canvas.height === image.height &&
              pixels.every(
                (value, index) => Math.abs(value - image.data[index]) <= 1,
              );
            return equal === matches;
          },
          { image: expected, matches },
        );
      const waitForOverlayContent = (expected) =>
        page.waitForFunction((hasContent) => {
          const canvas = globalThis.document.querySelector(
            '[data-editor-picture] canvas[aria-hidden="true"]',
          );
          const pixels =
            canvas.width && canvas.height
              ? canvas
                  .getContext("2d")
                  .getImageData(0, 0, canvas.width, canvas.height).data
              : [];
          return (
            pixels.some((value, index) => index % 4 === 3 && value > 0) ===
            hasContent
          );
        }, expected);
      await waitForOverlayContent(false);
      await add.click();
      assert.equal(
        await page
          .getByRole("textbox", {
            name: "Edit subtitle cue in point",
            exact: true,
          })
          .inputValue(),
        "0:01.00",
      );
      await waitForOverlayContent(true);
      const created = await readOverlay();
      const text = page.getByRole("textbox", {
        name: "Subtitle text",
        exact: true,
      });
      await text.fill("Edited while paused");
      await waitForOverlay(created, false);
      await waitForOverlayContent(true);
      const edited = await readOverlay();
      assert.equal(
        await page
          .getByRole("button", { name: "Play preview", exact: true })
          .count(),
        1,
      );
      const undo = page.getByRole("button", { name: "Undo", exact: true });
      await undo.click();
      await waitForOverlay(created);
      await undo.click();
      // Clearing may retain the bitmap size; only visible pixels matter here.
      await waitForOverlayContent(false);
      assert.equal(await undo.isDisabled(), true, "Creation is one undo step");
      const redo = page.getByRole("button", { name: "Redo", exact: true });
      await redo.click();
      await redo.click();
      await waitForOverlay(edited);
    } finally {
      await page.close();
    }
  }
  process.stdout.write(
    "Passed paused subtitle creation and live text preview between/on frames\n",
  );
}

export async function checkEditorReviewRegressions({ browser, url }) {
  await checkPausedSubtitlePreview({ browser, url });
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
