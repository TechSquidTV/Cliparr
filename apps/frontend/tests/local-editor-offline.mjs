import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { preview } from "vite";

export async function waitForOfflineEditor(page) {
  await page.waitForFunction(
    () => navigator.serviceWorker.controller?.state === "activated",
  );
}

export async function checkLocalEditorUpdates(browser, outDir, fixture) {
  const worker = await readFile(path.join(outDir, "service-worker.js"), "utf8");
  const originalVersion = /const CACHE_VERSION = "([^"]+)"/u.exec(worker)?.[1];
  assert.ok(originalVersion);
  let deployment = originalVersion;
  const server = await preview({
    configFile: false,
    base: "/try/",
    logLevel: "error",
    build: { outDir },
    preview: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "simulate-offline-editor-deployments",
        configurePreviewServer(server) {
          server.middlewares.use((request, response, next) => {
            const pathname = new URL(request.url, "http://localhost").pathname;
            let body;
            let contentType;
            if (pathname === "/try/service-worker.js") {
              body = worker.replaceAll(originalVersion, deployment);
              if (deployment === "broken") {
                body = body.replace(
                  "const ASSET_URLS = [",
                  'const ASSET_URLS = ["/try/missing.js",',
                );
              }
              contentType = "text/javascript";
            } else if (pathname === "/try/missing.js") {
              response.writeHead(404).end();
              return;
            } else {
              next();
              return;
            }
            response
              .writeHead(200, {
                "content-type": contentType,
                "cache-control": "no-store",
              })
              .end(body);
          });
        },
      },
    ],
  });
  const context = await browser.newContext();
  try {
    const url = server.resolvedUrls.local[0];
    const page = await context.newPage();
    await page.goto(url);
    await waitForOfflineEditor(page);
    const second = await context.newPage();
    await second.goto(url);
    await waitForOfflineEditor(second);

    const update = (page) =>
      page.evaluate(async () => {
        const registration =
          await navigator.serviceWorker.getRegistration("/try/");
        const installed = new Promise((resolve) => {
          registration.addEventListener(
            "updatefound",
            () => {
              const worker = registration.installing;
              worker.addEventListener("statechange", () => {
                if (["installed", "redundant"].includes(worker.state)) {
                  resolve(worker.state);
                }
              });
            },
            { once: true },
          );
        });
        await registration.update();
        return installed;
      });
    const cacheNames = () => page.evaluate(() => globalThis.caches.keys());

    deployment = "broken";
    assert.equal(await update(page), "redundant");
    await page
      .getByText("Could not download the update.", { exact: false })
      .waitFor();
    const retainedCaches = await cacheNames();
    assert.ok(retainedCaches.includes(`cliparr-try-${originalVersion}`));

    deployment = "updated";
    assert.equal(await update(page), "installed");
    for (const tab of [page, second]) {
      await tab.getByText("Update available.", { exact: false }).waitFor();
    }
    await context.setOffline(true);
    // Waiting builds must leave the active build's lazy editor modules available.
    await page.locator('input[type="file"]').setInputFiles(fixture);
    await page
      .getByRole("button", { name: "Play preview", exact: true })
      .waitFor();
    await page.close();
    assert.equal(
      await second.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return registration.waiting?.state;
      }),
      "installed",
    );
    await second.close();

    const reopened = await context.newPage();
    await reopened.goto(url);
    await waitForOfflineEditor(reopened);
    await reopened.waitForFunction(async () => {
      const names = await globalThis.caches.keys();
      return names.length === 1 && names[0] === "cliparr-try-updated";
    });
    for (const suffix of ["index.html", "nested/path"]) {
      await reopened.goto(new URL(suffix, url).href);
      await reopened.getByRole("heading", { name: "Capture A Clip" }).waitFor();
      await reopened
        .getByRole("link", { name: "Cliparr", exact: true })
        .click();
      assert.equal(new URL(reopened.url()).pathname, "/try/");
    }
    process.stdout.write(
      "PASS offline editor updates, failed install, cached navigations, and scoped home link\n",
    );
  } finally {
    await context.close();
    await server.close();
  }
}
