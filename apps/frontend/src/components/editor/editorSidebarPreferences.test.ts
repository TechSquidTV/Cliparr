/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_EDITOR_PROPERTIES_OPEN_SECTIONS,
  EDITOR_PROPERTIES_SECTION_ID,
  loadEditorPropertiesOpenSections,
  saveEditorPropertiesOpenSections,
} from "@/components/editor/editorSidebarPreferences";

const editorPropertiesAccordionStorageKey =
  "cliparr.editor.properties.accordion.v1";

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

void test("defaults editor properties accordion sections without storage", () => {
  withStorage({}, () => {
    assert.deepEqual(
      loadEditorPropertiesOpenSections(),
      DEFAULT_EDITOR_PROPERTIES_OPEN_SECTIONS,
    );
  });
});

void test("loads saved open editor properties accordion sections", () => {
  withStorage(
    {
      [editorPropertiesAccordionStorageKey]: JSON.stringify({
        openSections: [
          EDITOR_PROPERTIES_SECTION_ID.selection,
          EDITOR_PROPERTIES_SECTION_ID.globalSubtitles,
        ],
      }),
    },
    () => {
      assert.deepEqual(
        loadEditorPropertiesOpenSections(),
        DEFAULT_EDITOR_PROPERTIES_OPEN_SECTIONS,
      );
    },
  );
});

void test("loads saved single editor properties accordion section", () => {
  withStorage(
    {
      [editorPropertiesAccordionStorageKey]: JSON.stringify({
        openSections: [EDITOR_PROPERTIES_SECTION_ID.globalSubtitles],
      }),
    },
    () => {
      assert.deepEqual(loadEditorPropertiesOpenSections(), [
        EDITOR_PROPERTIES_SECTION_ID.globalSubtitles,
      ]);
    },
  );
});

void test("loads saved closed editor properties accordion sections", () => {
  withStorage(
    {
      [editorPropertiesAccordionStorageKey]: JSON.stringify({
        openSections: [],
      }),
    },
    () => {
      assert.deepEqual(loadEditorPropertiesOpenSections(), []);
    },
  );
});

void test("filters unknown editor properties accordion section ids", () => {
  withStorage(
    {
      [editorPropertiesAccordionStorageKey]: JSON.stringify({
        openSections: [
          "preview-source",
          EDITOR_PROPERTIES_SECTION_ID.selection,
          EDITOR_PROPERTIES_SECTION_ID.globalSubtitles,
          "export",
        ],
      }),
    },
    () => {
      assert.deepEqual(
        loadEditorPropertiesOpenSections(),
        DEFAULT_EDITOR_PROPERTIES_OPEN_SECTIONS,
      );
    },
  );
});

void test("deduplicates editor properties accordion section ids", () => {
  withStorage(
    {
      [editorPropertiesAccordionStorageKey]: JSON.stringify({
        openSections: [
          EDITOR_PROPERTIES_SECTION_ID.selection,
          EDITOR_PROPERTIES_SECTION_ID.globalSubtitles,
          EDITOR_PROPERTIES_SECTION_ID.selection,
          EDITOR_PROPERTIES_SECTION_ID.globalSubtitles,
        ],
      }),
    },
    () => {
      assert.deepEqual(
        loadEditorPropertiesOpenSections(),
        DEFAULT_EDITOR_PROPERTIES_OPEN_SECTIONS,
      );
    },
  );
});

void test("falls back to default editor properties accordion sections for invalid storage", () => {
  withStorage(
    {
      [editorPropertiesAccordionStorageKey]: "nope",
    },
    () => {
      assert.deepEqual(
        loadEditorPropertiesOpenSections(),
        DEFAULT_EDITOR_PROPERTIES_OPEN_SECTIONS,
      );
    },
  );

  withStorage(
    {
      [editorPropertiesAccordionStorageKey]: JSON.stringify({
        openSections: true,
      }),
    },
    () => {
      assert.deepEqual(
        loadEditorPropertiesOpenSections(),
        DEFAULT_EDITOR_PROPERTIES_OPEN_SECTIONS,
      );
    },
  );
});

void test("saves editor properties accordion sections", () => {
  withStorage({}, (storage) => {
    saveEditorPropertiesOpenSections([]);

    assert.equal(
      storage.get(editorPropertiesAccordionStorageKey),
      JSON.stringify({ openSections: [] }),
    );

    saveEditorPropertiesOpenSections(DEFAULT_EDITOR_PROPERTIES_OPEN_SECTIONS);

    assert.equal(
      storage.get(editorPropertiesAccordionStorageKey),
      JSON.stringify({
        openSections: [
          EDITOR_PROPERTIES_SECTION_ID.selection,
          EDITOR_PROPERTIES_SECTION_ID.globalSubtitles,
        ],
      }),
    );
  });
});
