import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createApp } from "@/app";
import { closeDatabase } from "@/db/database";

const TEST_APP_KEY = "route-test-key-with-at-least-32-characters";

export function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

export async function withTestApp<T>(
  callback: (baseUrl: string, fetchLocal: typeof fetch) => Promise<T>,
) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cliparr-route-test-"));
  const previousAppKey = process.env.APP_KEY;
  const previousDataDir = process.env.CLIPARR_DATA_DIR;

  process.env.APP_KEY = TEST_APP_KEY;
  process.env.CLIPARR_DATA_DIR = dataDir;

  const { app } = await createApp();
  const server = app.listen(0, "127.0.0.1");
  const originalFetch = globalThis.fetch;

  try {
    await new Promise((resolve) => {
      server.once("listening", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    return await callback(`http://127.0.0.1:${address.port}`, originalFetch);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    globalThis.fetch = originalFetch;
    closeDatabase();
    restoreEnv("APP_KEY", previousAppKey);
    restoreEnv("CLIPARR_DATA_DIR", previousDataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}
