/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { loadSubtitleStyleSettings } from "@/lib/subtitles/settings";

const subtitleStyleSettingsStorageKey = "cliparr.subtitle.style-settings.v3";
const legacySubtitleStyleSettingsStorageKey =
  "cliparr.subtitle.style-settings.v1";
const unflippedSubtitleStyleSettingsStorageKey =
  "cliparr.subtitle.style-settings.v2";

function withStorage<T>(
  initialValues: Record<string, string>,
  callback: (storage: Map<string, string>) => T,
) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalLocalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const storage = new Map(Object.entries(initialValues));
  const localStorage = {
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  });

  try {
    return callback(storage);
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }

    if (originalLocalStorage) {
      Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
    } else {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  }
}

void test("loads and clamps subtitle position from v3 settings", () => {
  withStorage(
    {
      [subtitleStyleSettingsStorageKey]: JSON.stringify({
        positionX: 150,
        positionY: 175,
      }),
    },
    () => {
      const settings = loadSubtitleStyleSettings();
      assert.equal(settings.positionX, 100);
      assert.equal(settings.positionY, 100);
    },
  );

  withStorage(
    {
      [subtitleStyleSettingsStorageKey]: JSON.stringify({
        positionX: -25,
        positionY: -25,
      }),
    },
    () => {
      const settings = loadSubtitleStyleSettings();
      assert.equal(settings.positionX, 0);
      assert.equal(settings.positionY, 0);
    },
  );
});

void test("defaults missing subtitle horizontal position to center", () => {
  withStorage(
    {
      [subtitleStyleSettingsStorageKey]: JSON.stringify({
        positionY: 20,
      }),
    },
    () => {
      const settings = loadSubtitleStyleSettings();
      assert.equal(settings.positionX, 50);
      assert.equal(settings.positionY, 20);
    },
  );
});

void test("ignores legacy subtitle position settings", () => {
  withStorage(
    {
      [legacySubtitleStyleSettingsStorageKey]: JSON.stringify({
        bottomMargin: 240,
      }),
      [unflippedSubtitleStyleSettingsStorageKey]: JSON.stringify({
        positionY: 90,
      }),
    },
    () => {
      const settings = loadSubtitleStyleSettings();
      assert.equal(settings.positionX, 50);
      assert.equal(settings.positionY, 10);
    },
  );
});
