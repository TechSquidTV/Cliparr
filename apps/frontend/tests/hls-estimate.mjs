import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  configFile: `${root}/vite.config.js`,
  server: { port: 0 },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.clock.install();
  await page.addInitScript(() => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      if (String(input).endsWith("/slow.m3u8")) {
        init.signal.addEventListener("abort", () => {
          globalThis.document.body.dataset.aborted = "true";
        });
      }
      return originalFetch(input, init);
    };
  });
  let requests = 0;
  let holdRefresh = false;
  let pendingRefresh;
  const playlist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480
480p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5400000,RESOLUTION=1920x1080
1080p.m3u8`;
  await page.route("**/*.m3u8", async (route) => {
    requests++;
    if (route.request().url().endsWith("/slow.m3u8")) {
      return;
    }
    if (holdRefresh) {
      pendingRefresh = route;
      return;
    }
    await route.fulfill({ body: playlist });
  });
  await page.goto(`${server.resolvedUrls.local[0]}tests/hls-estimate.html`);
  await page.getByText("1200", { exact: true }).waitFor();
  await page.getByText("resolution").click();
  await page.getByText("5400", { exact: true }).waitFor();
  assert.equal(requests, 1);
  await page.getByText("close", { exact: true }).click();
  await page.getByText("none", { exact: true }).waitFor();
  await page.getByText("open", { exact: true }).click();
  await page.getByText("5400", { exact: true }).waitFor();
  assert.equal(requests, 1);
  await page.getByText("close", { exact: true }).click();
  await page.clock.fastForward(60_000);
  assert.equal(requests, 1);
  holdRefresh = true;
  await page.getByText("open", { exact: true }).click();
  await expectRequests(2);
  await page.getByText("none", { exact: true }).waitFor({ timeout: 1500 });
  await page.clock.fastForward(120_000);
  assert.equal(await page.locator("output").textContent(), "none");
  assert.equal(requests, 2);
  assert.ok(pendingRefresh);
  holdRefresh = false;
  await pendingRefresh.fulfill({ body: playlist });
  await page.getByText("5400", { exact: true }).waitFor();
  await page.clock.fastForward(60_000);
  await expectRequests(3);
  await page.getByText("source", { exact: true }).click();
  await expectRequests(4);
  await page.getByText("session", { exact: true }).click();
  await expectRequests(5);
  await page.getByText("slow", { exact: true }).click();
  await expectRequests(6);
  await page.getByText("close", { exact: true }).click();
  await page.waitForFunction(
    () => globalThis.document.body.dataset.aborted === "true",
  );
  await page.getByText("none", { exact: true }).waitFor();
  await page.clock.fastForward(120_000);
  assert.equal(requests, 6);
  async function expectRequests(count) {
    await assertEventually(() => requests === count);
  }
  async function assertEventually(predicate) {
    for (let index = 0; index < 100; index++) {
      if (predicate()) {
        return;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
    }
    assert.fail(`Expected request count, got ${requests}`);
  }
} finally {
  await browser.close();
  await server.close();
}
