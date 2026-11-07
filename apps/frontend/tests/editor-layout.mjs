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

async function assertTimecodeEditorLayout(page, field) {
  const inputField = page.getByRole("textbox", {
    name: `Edit ${field}`,
    exact: true,
  });
  const input = await inputField.boundingBox();
  const cancel = await page
    .getByRole("button", { name: `Cancel ${field} edit`, exact: true })
    .boundingBox();
  const textSize = await inputField.evaluate((element) => {
    return {
      available: element.clientWidth,
      required: element.scrollWidth,
    };
  });
  assert.ok(
    textSize.available >= textSize.required,
    `${field}: input fits its value without scrolling ${JSON.stringify(textSize)}`,
  );
  assert.ok(
    input &&
      cancel &&
      (input.x + input.width <= cancel.x + 1 ||
        input.y + input.height <= cancel.y + 1),
    `${field}: Cancel has its own space`,
  );
  const viewport = page.viewportSize();
  assert.ok(
    viewport &&
      cancel &&
      cancel.x >= 0 &&
      cancel.x + cancel.width <= viewport.width + 1,
    `${field}: Cancel stays inside the viewport`,
  );
}

async function checkTouchTrimTargets(browser, url) {
  const page = await browser.newPage({
    viewport: { width: 402, height: 874 },
    isMobile: true,
    hasTouch: true,
  });
  await page.goto(url);
  await page.locator("[data-editor-timeline-ready]").waitFor();
  const touch = await page.context().newCDPSession(page);
  const range = page.getByRole("slider", { name: "Move clip selection" });
  const selection = page.locator(".editor-media-range-selection");
  const start = page.getByRole("slider", { name: "Clip start" });
  const end = page.getByRole("slider", { name: "Clip end" });
  const preview = page.getByRole("button", { name: /^Edit preview time:/ });
  const playheadLine = page.locator(".timeline-playhead-grabber-line");

  async function positionPlayhead(time) {
    await preview.click();
    const field = page.getByRole("textbox", {
      name: "Edit preview time",
      exact: true,
    });
    await field.fill(time);
    await field.press("Enter");
    const line = await playheadLine.boundingBox();
    assert.ok(line);
    return line.x + line.width / 2;
  }

  async function setRange(inTime, outTime) {
    await page.getByRole("button", { name: "Trim", exact: true }).click();
    // Set the far edge first when moving the range later in the clip.
    const fields = [
      ["In", inTime],
      ["Out", outTime],
    ];
    if (outTime > Number(await end.getAttribute("aria-valuenow"))) {
      fields.reverse();
    }
    for (const [edge, value] of fields) {
      await page
        .getByRole("button", { name: new RegExp(`^Edit ${edge} time:`) })
        .click();
      const field = page.getByRole("textbox", {
        name: `Edit ${edge} time`,
        exact: true,
      });
      await field.fill(String(value));
      await field.press("Enter");
    }
    await page.getByRole("button", { name: "Done", exact: true }).click();
  }

  async function touchDrag(x, y, delta) {
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + delta, y }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }

  async function drag(part, x, y, delta) {
    assert.ok(
      await part.evaluate(
        (element, point) =>
          element === globalThis.document.elementFromPoint(point.x, point.y),
        { x, y },
      ),
      `Contact hits ${await part.getAttribute("aria-label")} at ${x}, ${y}`,
    );
    const beforeStart = Number(await start.getAttribute("aria-valuenow"));
    const beforeEnd = Number(await end.getAttribute("aria-valuenow"));
    await touchDrag(x, y, delta);
    const startDelta =
      Number(await start.getAttribute("aria-valuenow")) - beforeStart;
    const endDelta =
      Number(await end.getAttribute("aria-valuenow")) - beforeEnd;
    if (part === start) {
      assert.ok(
        startDelta * delta > 0 && endDelta === 0,
        "Grip trims only the start",
      );
    } else if (part === end) {
      assert.ok(
        endDelta * delta > 0 && startDelta === 0,
        "Grip trims only the end",
      );
    } else {
      assert.ok(
        startDelta * delta > 0 && Math.abs(startDelta - endDelta) < 0.001,
        "Center moves the whole range",
      );
    }
  }

  await setRange(1, 1.16);
  let box = await selection.boundingBox();
  assert.ok(box && box.width < 44);
  const y = box.y + box.height / 2;
  await drag(start, box.x - 18, y, 6);
  await drag(end, box.x + box.width + 18, y, -6);
  box = await selection.boundingBox();
  await drag(range, box.x + box.width / 2, y, 6);

  // Place a 28px selection flush against each edge of the visible media row.
  const row = await page.locator(".editor-media-range-row").boundingBox();
  const track = await page.locator(".editor-media-range").boundingBox();
  const scale = track.width / Number(await end.getAttribute("aria-valuemax"));
  for (const side of ["left", "right"]) {
    const left = side === "left" ? row.x : row.x + row.width - 28;
    const inTime = (left - track.x) / scale;
    const outTime = (left + 28 - track.x) / scale;
    const direction = side === "left" ? 1 : -1;
    const edge = side === "left" ? start : end;
    for (const grip of [false, true]) {
      await setRange(inTime, outTime);
      box = await selection.boundingBox();
      assert.ok(
        Math.abs(box.x - left) < 1 && Math.abs(box.width - 28) < 1,
        `Short selection sits at the ${side} viewport edge`,
      );
      const middle = box.x + box.width / 2;
      // Each visible grip is centered in the outer quarter of a short clip.
      const x = grip ? middle - (direction * box.width * 3) / 8 : middle;
      const part = grip ? edge : range;
      await drag(part, x, box.y + box.height / 2, direction * 6);
    }
  }
  // A centered playhead and the move control share the middle of this 45px clip.
  for (const direction of [-1, 1]) {
    await setRange(0.4, 0.58);
    const playheadX = await positionPlayhead("0.49");
    box = await selection.boundingBox();
    assert.ok(
      box &&
        Math.abs(box.width - 45) < 1 &&
        Math.abs(playheadX - (box.x + box.width / 2)) < 1,
      "Playhead is centered on the short selection",
    );
    const previewBefore = await preview.getAttribute("aria-label");
    await touchDrag(playheadX + direction * 9, y, (direction * scale) / 10);
    assert.equal(
      Number(await start.getAttribute("aria-valuenow")),
      direction < 0 ? 0.3 : 0.5,
      "Dragging beside the playhead moves the In point",
    );
    assert.equal(
      Number(await end.getAttribute("aria-valuenow")),
      direction < 0 ? 0.48 : 0.68,
      "The Out point moves by the same amount",
    );
    assert.equal(
      await preview.getAttribute("aria-label"),
      previewBefore,
      "Moving the selection preserves preview time",
    );
  }
  // Scrub directly on the line in the same short clip and beside each long-clip grip.
  for (const [inTime, outTime, from, to, direction] of [
    [0.4, 0.58, "0.49", "0:00.59", 1],
    [0.2, 1.3, "0.75", "0:00.85", 1],
    [0.2, 1.3, "0.30", "0:00.40", 1],
    [0.2, 1.3, "1.20", "0:01.10", -1],
  ]) {
    await setRange(inTime, outTime);
    const playheadX = await positionPlayhead(from);
    await touchDrag(
      playheadX,
      row.y + row.height / 2,
      (direction * scale) / 10,
    );
    assert.equal(
      Number(await start.getAttribute("aria-valuenow")),
      inTime,
      "Scrubbing preserves the In point",
    );
    assert.equal(
      Number(await end.getAttribute("aria-valuenow")),
      outTime,
      "Scrubbing preserves the Out point",
    );
    await page
      .getByRole("button", {
        name: `Edit preview time: ${to} of 0:04.00`,
        exact: true,
      })
      .waitFor();
  }

  await page.close();
}

export async function checkEditorLayouts({ browser, url, screenshots }) {
  await checkTouchTrimTargets(browser, url);
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
      { width: 375, height: 667 },
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
        const bounds = await dock.boundingBox();
        assert.ok(
          bounds && bounds.y + bounds.height <= viewport.height + 1,
          `${shape} ${viewport.width}: tools are reachable`,
        );
        if (viewport.width === 375) {
          await dock
            .getByRole("button", { name: "Subtitles", exact: true })
            .click();
          assert.deepEqual(
            await dock.boundingBox(),
            bounds,
            "Opening Subtitles keeps the dock in place on a short phone",
          );
          await page.getByRole("button", { name: "Done", exact: true }).click();
        }
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
      await page.locator(".editor-mobile-workspace").evaluate((workspace) => {
        return workspace.scrollHeight <= workspace.clientHeight + 1;
      }),
      "Default workspace needs no vertical scroll",
    );
    await page.setViewportSize({ width: 320, height: 874 });
    await page.getByRole("button", { name: /Edit preview time:/ }).click();
    await page
      .getByRole("textbox", { name: "Edit preview time", exact: true })
      .fill("00:00:02.000");
    await assertTimecodeEditorLayout(page, "preview time");
    await page
      .getByRole("button", { name: "Cancel preview time edit", exact: true })
      .click();
    await page.setViewportSize({ width: 402, height: 874 });
    await dock.getByRole("button", { name: "Trim", exact: true }).click();
    const inButton = page.getByRole("button", { name: /Edit In time:/ });
    const initialInLabel = await inButton.getAttribute("aria-label");
    assert.equal(
      await page.getByRole("button", { name: "Undo", exact: true }).isEnabled(),
      false,
    );
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
    await assertTimecodeEditorLayout(page, "In time");
    await inField.press("Tab");
    const cancelIn = page.getByRole("button", {
      name: "Cancel In time edit",
      exact: true,
    });
    assert.equal(
      await inField.count(),
      1,
      "Tabbing to Cancel keeps the draft open",
    );
    assert.ok(
      await cancelIn.evaluate(
        (element) => element === globalThis.document.activeElement,
      ),
    );
    await cancelIn.press("Enter");
    assert.equal(
      await inButton.getAttribute("aria-label"),
      initialInLabel,
      "Keyboard Cancel discards the mobile draft",
    );
    assert.equal(
      await page.getByRole("button", { name: "Undo", exact: true }).isEnabled(),
      false,
      "Keyboard Cancel adds no history entry",
    );
    await inButton.click();
    await inField.fill("0.25");
    await inField.press("Tab");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await dock.getByRole("button", { name: "Trim", exact: true }).click();
    assert.match(
      await inButton.getAttribute("aria-label"),
      /0:00\.25/,
      "A tool transition commits even when Cancel owned focus",
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    assert.equal(
      await inButton.getAttribute("aria-label"),
      initialInLabel,
      "Leaving the edit records one undo step",
    );
    await inButton.click();
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
    const outButton = page.getByRole("button", { name: /Edit Out time:/ });
    const initialOutLabel = await outButton.getAttribute("aria-label");
    await outButton.click();
    const outField = page.getByRole("textbox", {
      name: "Edit Out time",
      exact: true,
    });
    await assertTimecodeEditorLayout(page, "Out time");
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.evaluate(() => {
      globalThis.document.documentElement.style.fontSize = "125%";
    });
    await assertTimecodeEditorLayout(page, "Out time");
    await page.evaluate(() => {
      globalThis.document.documentElement.style.removeProperty("font-size");
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await outField.fill("00:00:02.000");
    await assertTimecodeEditorLayout(page, "Out time");
    await outField.press("Tab");
    const cancelOut = page.getByRole("button", {
      name: "Cancel Out time edit",
      exact: true,
    });
    assert.equal(
      await outField.count(),
      1,
      "Desktop keyboard cancellation keeps the draft open",
    );
    await cancelOut.press("Enter");
    assert.equal(
      await outButton.getAttribute("aria-label"),
      initialOutLabel,
      "Keyboard Cancel discards the desktop draft",
    );
    await outButton.click();
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
    await assertTimecodeEditorLayout(page, "subtitle cue in point");
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
      await page
        .locator(".editor-mobile-workspace")
        .evaluate(
          (element) => element.scrollHeight <= element.clientHeight + 1,
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
