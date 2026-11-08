import assert from "node:assert/strict";

/** Pan a visible region with native touch input and verify actual scrolling. */
export async function scrollWithTouch({ page, session, scroller }) {
  const viewport = page.viewportSize();
  assert.ok(viewport, "Touch checks require a fixed emulated viewport");
  const cssViewport = await page.evaluate(() => ({
    width: globalThis.innerWidth,
    height: globalThis.innerHeight,
  }));
  // Device emulation can leave the native content area shorter than the CSS
  // viewport after a resize. Native gestures must fit in both coordinate spaces.
  const { windowId } = await session.send("Browser.getWindowForTarget");
  await session.send("Browser.setContentsSize", { windowId, ...viewport });
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolve),
        );
      }),
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      width: globalThis.innerWidth,
      height: globalThis.innerHeight,
    })),
    cssViewport,
    "Synchronizing the native window preserves the emulated editor layout",
  );
  const start = await scroller.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const top = Math.max(0, bounds.top);
    const bottom = Math.min(globalThis.innerHeight, bounds.bottom);
    const left = Math.max(0, bounds.left);
    const right = Math.min(globalThis.innerWidth, bounds.right);
    const x = (left + right) / 2;
    const y = bottom - 12;
    return {
      x,
      y,
      distance: Math.min(120, bottom - top - 24),
      scrollTop: element.scrollTop,
      scrollable: element.scrollHeight > element.clientHeight,
      ownsPoint: element.contains(globalThis.document.elementFromPoint(x, y)),
    };
  });
  assert.ok(start.scrollable, "Touch scroll target has overflowing content");
  assert.ok(
    start.ownsPoint && start.distance > 0,
    "Touch swipe starts inside the visible scroll region",
  );
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: start.x, y: start.y, id: 0 }],
  });
  try {
    for (let step = 1; step <= 8; step++) {
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            globalThis.requestAnimationFrame(resolve);
          }),
      );
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: start.x, y: start.y - (start.distance * step) / 8, id: 0 },
        ],
      });
    }
  } finally {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  await page.waitForFunction(
    ({ element, before }) => element.scrollTop > before,
    { element: await scroller.elementHandle(), before: start.scrollTop },
  );
}
