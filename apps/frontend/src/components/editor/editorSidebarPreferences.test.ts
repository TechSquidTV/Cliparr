/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_EDITOR_PROPERTIES_OPEN_SECTIONS,
  EDITOR_PROPERTIES_SECTION_ID,
  loadEditorPropertiesOpenSections,
  saveEditorPropertiesOpenSections,
} from "@/components/editor/editorSidebarPreferences";
import { withStorage } from "#tests/storage.test-support.ts";

const editorPropertiesAccordionStorageKey =
  "cliparr.editor.subtitles.accordion.v1";

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
        openSections: [EDITOR_PROPERTIES_SECTION_ID.subtitleStyle],
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
          EDITOR_PROPERTIES_SECTION_ID.subtitleStyle,
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
          EDITOR_PROPERTIES_SECTION_ID.subtitleStyle,
          EDITOR_PROPERTIES_SECTION_ID.subtitleStyle,
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
        openSections: [EDITOR_PROPERTIES_SECTION_ID.subtitleStyle],
      }),
    );
  });
});
