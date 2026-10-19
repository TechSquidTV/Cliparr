import assert from "node:assert/strict";
import test from "node:test";

import { chooseExportFile } from "#/lib/export/exportFile";

async function withBrowserWindow(browser: object, run: () => Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browser,
  });
  try {
    await run();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "window", descriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
}

void test("uses download output when a native picker is unavailable", async () => {
  await withBrowserWindow({}, async () => {
    assert.deepEqual(await chooseExportFile("clip.mp4", "mp4"), {
      status: "download",
    });
  });
});

void test("keeps GIF output on its dedicated download path", async () => {
  await withBrowserWindow(
    {
      showSaveFilePicker: () => {
        assert.fail("GIF must not open a native picker");
      },
    },
    async () => {
      assert.deepEqual(await chooseExportFile("clip.gif", "gif"), {
        status: "download",
      });
    },
  );
});

void test("preserves the native picker’s selected file and filename", async () => {
  const handle = { name: "renamed.mp4" } as FileSystemFileHandle;
  await withBrowserWindow(
    {
      showSaveFilePicker: async (options: { suggestedName: string }) => {
        assert.equal(options.suggestedName, "clip.mp4");
        return handle;
      },
    },
    async () => {
      assert.deepEqual(await chooseExportFile("clip.mp4", "mp4"), {
        status: "selected",
        handle,
      });
    },
  );
});

void test("reports only a dismissed picker as cancellation", async () => {
  await withBrowserWindow(
    {
      showSaveFilePicker: async () => {
        throw new DOMException("Dismissed", "AbortError");
      },
    },
    async () => {
      assert.deepEqual(await chooseExportFile("clip.mp4", "mp4"), {
        status: "cancelled",
      });
    },
  );
  const failure = new DOMException("Disk is full", "QuotaExceededError");
  await withBrowserWindow(
    {
      showSaveFilePicker: async () => {
        throw failure;
      },
    },
    async () => {
      await assert.rejects(
        chooseExportFile("clip.mp4", "mp4"),
        (error: Error) => error === failure,
      );
    },
  );
});
