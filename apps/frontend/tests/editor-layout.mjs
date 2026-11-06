import assert from "node:assert/strict";
import path from "node:path";

import { scrollWithTouch } from "#tests/browser-gestures.mjs";

async function assertTransportLayout(page, label) {
  const time = await page
    .getByRole("button", { name: /Edit preview time:/ })
    .boundingBox();
  const play = await page
    .getByRole("button", { name: "Play preview", exact: true })
    .boundingBox();
  assert.ok(
    time &&
      play &&
      (time.x + time.width <= play.x + 1 ||
        play.x + play.width <= time.x + 1 ||
        time.y + time.height <= play.y + 1 ||
        play.y + play.height <= time.y + 1),
    `${label}: timecode does not overlap playback`,
  );
}

export async function checkEditorLayouts({ browser, url, screenshots }) {
  for (const { shape, ratio } of [
    { shape: "portrait", ratio: 9 / 16 },
    { shape: "square", ratio: 1 },
    { shape: "ultrawide", ratio: 4 },
  ]) {
    const page = await browser.newPage({
      viewport: { width: 402, height: 874 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
    });
    await page.goto(`${url}?shape=${shape}&long`);
    await page.locator("[data-editor-timeline-ready]").waitFor();
    await page
      .getByRole("button", { name: /Edit preview time:.*4:00:00/ })
      .waitFor();
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 402, height: 874 },
      { width: 768, height: 1024 },
      { width: 1023, height: 768 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            globalThis.requestAnimationFrame(() =>
              globalThis.requestAnimationFrame(resolve),
            );
          }),
      );
      await page.waitForFunction((ratio) => {
        const picture = globalThis.document.querySelector(
          "[data-editor-picture]",
        );
        const stage = globalThis.document.querySelector(
          "[data-editor-preview-stage]",
        );
        if (!picture || !stage) {
          return false;
        }
        const image = picture.getBoundingClientRect();
        const bounds = stage.getBoundingClientRect();
        return (
          image.height > 0 &&
          Math.abs(image.width / image.height - ratio) < 0.001 &&
          image.left >= bounds.left - 1 &&
          image.right <= bounds.right + 1 &&
          image.top >= bounds.top - 1 &&
          image.bottom <= bounds.bottom + 1
        );
      }, ratio);
      await assertTransportLayout(page, `${shape} ${viewport.width}`);
      assert.ok(
        await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth,
        ),
        `${shape} ${viewport.width}: no horizontal page overflow`,
      );
      if (viewport.width < 1024) {
        const dock = page.getByRole("navigation", { name: "Editing tools" });
        await dock.scrollIntoViewIfNeeded();
        const bounds = await dock.boundingBox();
        assert.ok(
          bounds && bounds.y + bounds.height <= viewport.height + 1,
          `${shape} ${viewport.width}: tools are reachable`,
        );
        await dock.getByRole("button", { name: "Trim", exact: true }).click();
        await page.getByRole("button", { name: /Edit Out time:/ }).click();
        await page
          .getByRole("textbox", { name: "Edit Out time", exact: true })
          .fill("3:59:59");
        await page
          .getByRole("textbox", { name: "Edit Out time", exact: true })
          .press("Enter");
        await page.getByRole("button", { name: "Done", exact: true }).click();
      }
    }
    if (shape === "portrait") {
      await page.setViewportSize({ width: 402, height: 874 });
      await page.evaluate(() => {
        globalThis.document.documentElement.style.fontSize = "200%";
      });
      const dock = page.getByRole("navigation", { name: "Editing tools" });
      await dock.scrollIntoViewIfNeeded();
      await assertTransportLayout(page, "Large text");
      assert.ok(
        await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth,
        ),
        "Large text does not cause page overflow",
      );
      for (const button of await dock.getByRole("button").all()) {
        assert.ok(
          await button.evaluate((element) => {
            const label = element.querySelector("span");
            return (
              !label ||
              label.getBoundingClientRect().width <=
                element.getBoundingClientRect().width + 1
            );
          }),
          "Large tool labels fit their targets",
        );
      }
      await page.screenshot({
        path: path.join(screenshots, "mobile-large-text.png"),
      });
      await page.evaluate(() => {
        globalThis.document.documentElement.style.removeProperty("font-size");
      });
    }
    await page.screenshot({
      path: path.join(screenshots, `long-${shape}-editor.png`),
    });
    await page.close();
    process.stdout.write(`Passed ${shape} long-media viewport matrix\n`);
  }
  for (const shape of ["portrait", "landscape"]) {
    const page = await browser.newPage({
      viewport: { width: 402, height: 874 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
    });
    await page.goto(`${url}?shape=${shape}`);
    await page.locator("[data-editor-timeline-ready]").waitFor();
    const expectedRatio = shape === "portrait" ? 9 / 16 : 16 / 9;
    await page.waitForFunction((ratio) => {
      const picture = globalThis.document.querySelector(
        "[data-editor-picture]",
      );
      if (!picture) {
        return false;
      }
      const bounds = picture.getBoundingClientRect();
      return (
        bounds.height > 0 &&
        Math.abs(bounds.width / bounds.height - ratio) < 0.001
      );
    }, expectedRatio);
    const picture = await page.locator("[data-editor-picture]").boundingBox();
    assert.ok(picture);
    await page.screenshot({
      path: path.join(screenshots, `mobile-${shape}-overview.png`),
    });
    if (shape === "portrait") {
      assert.ok(
        picture.height >= 874 / 3 && picture.height <= 874 / 2,
        `Portrait picture bounds: ${JSON.stringify(picture)}`,
      );
    } else {
      assert.ok(
        picture.width >= 350,
        "Landscape picture uses the available width",
      );
    }
    const exportButton = await page
      .getByRole("button", { name: "Export", exact: true })
      .boundingBox();
    assert.ok(
      exportButton && exportButton.height >= 44 && exportButton.width < 160,
    );
    const dock = page.getByRole("navigation", { name: "Editing tools" });
    const dockBounds = await dock.boundingBox();
    assert.ok(
      dockBounds && dockBounds.y + dockBounds.height <= 875,
      "Tool bar fits the phone viewport",
    );
    assert.ok(
      await dock.evaluate((element) => {
        const workspace = element.parentElement;
        return workspace.scrollHeight <= workspace.clientHeight + 1;
      }),
      "Default workspace needs no vertical scroll",
    );
    await dock.getByRole("button", { name: "Trim", exact: true }).click();
    await page.getByRole("button", { name: /Edit In time:/ }).click();
    const inField = page.getByRole("textbox", {
      name: "Edit In time",
      exact: true,
    });
    await inField.fill("0.25");
    await inField.dispatchEvent("keydown", {
      key: "Enter",
      code: "Enter",
      isComposing: true,
    });
    assert.equal(
      await inField.count(),
      1,
      "IME Enter does not finish a time edit",
    );
    await inField.fill("bad");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    assert.equal(
      await inField.inputValue(),
      "bad",
      "Invalid time remains editable after Done",
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await inField.waitFor();
    assert.equal(
      await inField.inputValue(),
      "bad",
      "Invalid time survives the desktop breakpoint",
    );
    await page.setViewportSize({ width: 402, height: 874 });
    await inField.waitFor();
    await page
      .getByRole("button", { name: "Cancel In time edit", exact: true })
      .click();
    await page.getByRole("button", { name: /Edit In time:/ }).click();
    await page
      .getByRole("textbox", { name: "Edit In time", exact: true })
      .fill("0.5");
    await page
      .getByRole("textbox", { name: "Edit In time", exact: true })
      .press("Enter");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page
      .getByRole("button", { name: "Edit clip range", exact: true })
      .waitFor();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: /Edit Out time:/ }).click();
    const outField = page.getByRole("textbox", {
      name: "Edit Out time",
      exact: true,
    });
    await outField.fill("unfinished");
    await page.setViewportSize({ width: 402, height: 874 });
    await dock.waitFor();
    await outField.waitFor();
    assert.equal(
      await outField.inputValue(),
      "unfinished",
      "Desktop range edit opens Trim when narrowing the viewport",
    );
    await page
      .getByRole("button", { name: "Cancel Out time edit", exact: true })
      .click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await dock.getByRole("button", { name: "Trim", exact: true }).focus();
    await page.keyboard.press("Enter");
    assert.ok(
      await page
        .getByRole("region", { name: "Trim", exact: true })
        .evaluate((element) => element === globalThis.document.activeElement),
      "Keyboard tool activation moves focus into the inspector",
    );
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await dock.getByRole("button", { name: "Playback", exact: true }).click();
    await page
      .getByRole("slider", { name: "Preview volume", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page
      .getByRole("button", { name: "Timeline view", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "Show track names", exact: true })
      .check();
    await page.keyboard.press("Escape");
    await dock.getByRole("button", { name: "Subtitles", exact: true }).click();
    await page
      .getByRole("button", { name: "Add subtitle", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Subtitle text", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("textbox", { name: "Subtitle text", exact: true })
        .evaluate((element) => element === globalThis.document.activeElement),
      false,
      "New subtitle does not automatically open the mobile keyboard",
    );
    const subtitleText = page.getByRole("textbox", {
      name: "Subtitle text",
      exact: true,
    });
    const textBounds = await subtitleText.boundingBox();
    const deleteBounds = await page
      .getByRole("button", { name: "Delete subtitle", exact: true })
      .boundingBox();
    const subtitleDock = await dock.boundingBox();
    assert.ok(
      textBounds && textBounds.width >= 378 && textBounds.height >= 120,
      "Subtitle text uses the panel width and available editing height",
    );
    assert.ok(
      deleteBounds &&
        subtitleDock &&
        deleteBounds.y + deleteBounds.height <= subtitleDock.y,
      "Text and cue actions fit above the bottom tools",
    );
    assert.ok(
      await subtitleText.evaluate((element) => {
        const panel = element.closest('[role="tabpanel"]');
        return panel && panel.scrollHeight <= panel.clientHeight + 1;
      }),
      "Text tab does not need an outer scrollbar",
    );
    const optionsBounds = await page
      .getByRole("button", { name: "Subtitle options", exact: true })
      .boundingBox();
    const doneBounds = await page
      .getByRole("button", { name: "Done", exact: true })
      .boundingBox();
    assert.ok(
      optionsBounds &&
        doneBounds &&
        optionsBounds.height <= 45 &&
        Math.abs(optionsBounds.y - doneBounds.y) <= 1,
      "Subtitle options and Done share a compact toolbar row",
    );
    await page.screenshot({
      path: path.join(screenshots, `mobile-${shape}-subtitle-text.png`),
    });
    await page.getByRole("tab", { name: "Style", exact: true }).click();
    assert.equal(
      await page.getByText("Style applies to all subtitles.").count(),
      0,
    );
    await page.screenshot({
      path: path.join(screenshots, `mobile-${shape}-subtitle-style.png`),
    });
    await page.getByRole("tab", { name: "Text", exact: true }).click();
    await subtitleText.fill(" ");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByText(/Blank text was not saved/).waitFor();
    await dock.getByRole("button", { name: "Subtitles", exact: true }).click();
    assert.equal(
      await subtitleText.inputValue(),
      "New subtitle",
      "Blank text preserves the existing cue",
    );
    await subtitleText.fill("Updated cue");
    await page.getByRole("tab", { name: "Timing", exact: true }).click();
    await page
      .getByRole("button", { name: /Edit subtitle cue in point:/ })
      .click();
    const cueTime = page.getByRole("textbox", {
      name: "Edit subtitle cue in point",
      exact: true,
    });
    await cueTime.fill("bad");
    await page.getByRole("tab", { name: "Style", exact: true }).click();
    assert.equal(
      await cueTime.inputValue(),
      "bad",
      "Invalid cue timing blocks a tab change",
    );
    await page
      .getByRole("button", {
        name: "Cancel subtitle cue in point edit",
        exact: true,
      })
      .click();
    await page.getByRole("tab", { name: "Style", exact: true }).click();
    await page.getByRole("slider", { name: "Size", exact: true }).waitFor();
    await page.getByRole("tab", { name: "Text", exact: true }).click();
    assert.equal(await subtitleText.inputValue(), "Updated cue");
    await subtitleText.dispatchEvent("compositionstart", { data: "正" });
    await subtitleText.fill("正在");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    assert.equal(
      await subtitleText.count(),
      1,
      "Navigation waits for composition to finish",
    );
    await subtitleText.dispatchEvent("compositionend", { data: "正在" });
    await page
      .getByRole("button", { name: "Edit clip range", exact: true })
      .waitFor();
    await dock.getByRole("button", { name: "Subtitles", exact: true }).click();
    assert.equal(await subtitleText.inputValue(), "正在");
    await page.screenshot({
      path: path.join(screenshots, `mobile-${shape}-subtitles.png`),
    });
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page
      .getByRole("button", { name: "Timeline view", exact: true })
      .click();
    await page.getByRole("button", { name: "Fit clip", exact: true }).click();
    await page.keyboard.press("Escape");
    const timeline = page.locator("[data-editor-timeline-viewport]");
    const timelineBounds = await timeline.boundingBox();
    const railBounds = await page
      .getByRole("button", { name: "Subtitle tools", exact: true })
      .boundingBox();
    assert.ok(timelineBounds && railBounds);
    const cueX = timelineBounds.x + 60;
    const cueY = railBounds.y + railBounds.height / 2;
    const touch = await page.context().newCDPSession(page);
    const beforeGesture = await page
      .locator("[data-editor-picture]")
      .boundingBox();
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: cueX, y: cueY, id: 0 }],
    });
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          globalThis.requestAnimationFrame(() =>
            globalThis.requestAnimationFrame(resolve),
          );
        }),
    );
    assert.equal(
      await dock
        .getByRole("button", { name: "Subtitles", exact: true })
        .getAttribute("aria-expanded"),
      "false",
      "Cue inspector stays closed until pointer release",
    );
    const duringGesture = await page
      .locator("[data-editor-picture]")
      .boundingBox();
    assert.equal(duringGesture.height, beforeGesture.height);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: cueX, y: cueY, id: 0 }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: cueX + 24, y: cueY, id: 0 }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    assert.equal(
      await dock
        .getByRole("button", { name: "Subtitles", exact: true })
        .getAttribute("aria-expanded"),
      "false",
      "Dragging a cue does not open its inspector",
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.touchscreen.tap(cueX, cueY);
    await subtitleText.waitFor();
    assert.equal(
      await subtitleText.evaluate(
        (element) => element === globalThis.document.activeElement,
      ),
      false,
    );
    await subtitleText.dispatchEvent("compositionstart", { data: "旋" });
    await subtitleText.fill("旋转");
    const composingField = await subtitleText.elementHandle();
    await page.setViewportSize({ width: 1280, height: 900 });
    assert.equal(
      await composingField.evaluate((element) => element.isConnected),
      true,
      "Desktop remount waits for composition completion",
    );
    await subtitleText.dispatchEvent("compositionend", { data: "旋转" });
    await dock.waitFor({ state: "detached" });
    const desktopSubtitles = page.locator("aside");
    assert.equal(await desktopSubtitles.getByRole("tab").count(), 0);
    assert.equal(
      await desktopSubtitles
        .getByRole("textbox", { name: "Subtitle text", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await desktopSubtitles
        .getByRole("slider", { name: "Size", exact: true })
        .count(),
      1,
    );
    await page.screenshot({
      path: path.join(screenshots, `desktop-${shape}-subtitles-stacked.png`),
    });
    await page
      .getByRole("button", { name: /Edit subtitle cue in point:/ })
      .click();
    await page
      .getByRole("textbox", { name: "Edit subtitle cue in point", exact: true })
      .fill("unfinished");
    await page.setViewportSize({ width: 402, height: 874 });
    await dock.waitFor();
    await page
      .getByRole("textbox", { name: "Edit subtitle cue in point", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("textbox", {
          name: "Edit subtitle cue in point",
          exact: true,
        })
        .inputValue(),
      "unfinished",
      "Desktop cue timing edits open the mobile Timing tab without losing the draft",
    );
    await page
      .getByRole("button", {
        name: "Cancel subtitle cue in point edit",
        exact: true,
      })
      .click();
    await page.getByRole("tab", { name: "Text", exact: true }).click();
    assert.equal(await subtitleText.inputValue(), "旋转");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    const viewStart = Number(
      await page
        .getByLabel("Timeline viewport", { exact: true })
        .getAttribute("aria-valuenow"),
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await dock.waitFor({ state: "detached" });
    await page.setViewportSize({ width: 402, height: 874 });
    await dock.waitFor();
    const restoredStart = Number(
      await page
        .getByLabel("Timeline viewport", { exact: true })
        .getAttribute("aria-valuenow"),
    );
    assert.ok(
      Math.abs(restoredStart - viewStart) < 0.02,
      `Timeline view survives breakpoint round trip: ${viewStart} -> ${restoredStart}`,
    );
    await page.evaluate(() => {
      globalThis.document.documentElement.style.setProperty(
        "--safe-area-top",
        "59px",
      );
      globalThis.document.documentElement.style.setProperty(
        "--safe-area-bottom",
        "34px",
      );
    });
    assert.ok(
      await dock.evaluate(
        (element) =>
          element.parentElement.scrollHeight <=
          element.parentElement.clientHeight + 1,
      ),
      "Safe areas do not introduce ordinary workspace scrolling",
    );
    await page.evaluate(() => {
      globalThis.document.documentElement.style.removeProperty(
        "--safe-area-top",
      );
      globalThis.document.documentElement.style.removeProperty(
        "--safe-area-bottom",
      );
    });
    await page.setViewportSize({ width: 874, height: 402 });
    await dock.waitFor();
    const landscapeDock = await dock.boundingBox();
    assert.ok(
      landscapeDock && landscapeDock.y + landscapeDock.height <= 403,
      "Landscape dock remains on screen",
    );
    await dock.getByRole("button", { name: "Playback", exact: true }).click();
    const landscapeDone = await page
      .getByRole("button", { name: "Done", exact: true })
      .boundingBox();
    assert.ok(
      landscapeDone && landscapeDone.y + landscapeDone.height <= 403,
      "Landscape inspector completion remains on screen",
    );
    await page.screenshot({
      path: path.join(screenshots, `landscape-${shape}-editor.png`),
    });
    await page.getByRole("button", { name: "Done", exact: true }).click();
    const more = page.getByRole("button", {
      name: "More editor options",
      exact: true,
    });
    await more.click();
    await page
      .getByRole("button", {
        name: "Export current preview frame",
        exact: true,
      })
      .click();
    const frameDialog = page.getByRole("dialog", {
      name: "Export Frame",
      exact: true,
    });
    await frameDialog.waitFor();
    await frameDialog
      .getByRole("button", { name: "Close frame export dialog", exact: true })
      .click();
    await frameDialog.waitFor({ state: "detached" });
    assert.equal(
      await more.evaluate(
        (element) => element === globalThis.document.activeElement,
      ),
      true,
      "Closing frame export restores the persistent More trigger",
    );
    await page.setViewportSize({ width: 402, height: 874 });
    await page.getByRole("button", { name: "Crop video", exact: true }).click();
    const cropControls = page.getByRole("region", {
      name: "Crop controls",
      exact: true,
    });
    const cropLabelSize = await cropControls
      .getByText("Aspect ratio", { exact: true })
      .evaluate((element) => globalThis.getComputedStyle(element).fontSize);
    const cropValueSize = await cropControls
      .getByRole("combobox", { name: "Aspect ratio", exact: true })
      .evaluate((element) => globalThis.getComputedStyle(element).fontSize);
    const cropInputSize = await cropControls
      .getByRole("spinbutton", { name: "Width", exact: true })
      .evaluate((element) => globalThis.getComputedStyle(element).fontSize);
    assert.equal(cropLabelSize, "14px", "Mobile property labels are readable");
    assert.equal(
      cropValueSize,
      cropLabelSize,
      "Selectors use the same mobile property size as labels",
    );
    assert.equal(
      cropInputSize,
      "16px",
      "Editable mobile fields retain their input size",
    );
    await page.screenshot({
      path: path.join(screenshots, `mobile-${shape}-crop-typography.png`),
    });
    const cropWidth = cropControls.getByRole("spinbutton", {
      name: "Width",
      exact: true,
    });
    const originalWidth = await cropWidth.inputValue();
    await cropWidth.fill("320");
    await page.setViewportSize({ width: 1280, height: 900 });
    await dock.waitFor({ state: "detached" });
    assert.equal(
      await cropWidth.inputValue(),
      "320",
      "A typed crop value commits before the responsive shell unmounts",
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    assert.equal(await cropWidth.inputValue(), originalWidth);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    assert.equal(await cropWidth.inputValue(), "320");
    await page.setViewportSize({ width: 402, height: 874 });
    await dock.waitFor();
    await page
      .getByRole("button", { name: "Remove crop", exact: true })
      .click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    assert.ok(
      await page
        .getByRole("button", { name: "Crop video", exact: true })
        .evaluate((element) => element === globalThis.document.activeElement),
      "Crop completion restores focus to the persistent tool launcher",
    );
    await page.setViewportSize({ width: 390, height: 600 });
    await page.getByRole("button", { name: "Crop video", exact: true }).click();
    const shortCropScroller = page
      .getByRole("region", { name: "Crop controls", exact: true })
      .locator("..");
    await shortCropScroller.waitFor();
    await page.screenshot({
      path: path.join(screenshots, `mobile-${shape}-short-crop.png`),
    });
    await shortCropScroller.evaluate((element) => {
      element.scrollTo({ top: 0 });
    });
    await scrollWithTouch({
      page,
      session: touch,
      scroller: shortCropScroller,
    });
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await touch.detach();
    process.stdout.write(`Passed mobile ${shape} layout and edit safety\n`);
    await page.close();
  }
}
