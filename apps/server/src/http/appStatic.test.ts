import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "@/app";
import { closeDatabase } from "@/db/database";

const TEST_APP_KEY = "app-static-test-key-with-at-least-32-characters";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

async function withProductionStaticApp<T>(
  callback: (baseUrl: string) => Promise<T>,
) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cliparr-app-data-"));
  const distPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "cliparr-frontend-dist-"),
  );
  const previousAppKey = process.env.APP_KEY;
  const previousDataDir = process.env.CLIPARR_DATA_DIR;
  const previousNodeEnv = process.env.NODE_ENV;

  fs.mkdirSync(path.join(distPath, "assets"));
  fs.writeFileSync(
    path.join(distPath, "index.html"),
    '<!doctype html><div id="root"></div>',
  );
  fs.writeFileSync(
    path.join(distPath, "assets/app-AbCdEf12.js"),
    "globalThis.__cliparrAssetLoaded = true;",
  );

  process.env.APP_KEY = TEST_APP_KEY;
  process.env.CLIPARR_DATA_DIR = dataDir;
  process.env.NODE_ENV = "production";

  const { app } = await createApp({ frontendDistPath: distPath });
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise((resolve) => {
      server.once("listening", resolve);
    });
    const address = server.address();
    assert(address && typeof address === "object");
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(undefined);
      });
    });
    closeDatabase();
    restoreEnv("APP_KEY", previousAppKey);
    restoreEnv("CLIPARR_DATA_DIR", previousDataDir);
    restoreEnv("NODE_ENV", previousNodeEnv);
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(distPath, { recursive: true, force: true });
  }
}

void test("serves hashed frontend assets with immutable caching", async () => {
  await withProductionStaticApp(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/assets/app-AbCdEf12.js`);

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
    );
  });
});

void test("keeps the app shell revalidatable in production", async () => {
  await withProductionStaticApp(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/editor`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.match(await response.text(), /id="root"/);
  });
});
